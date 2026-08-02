import {
  chooseSurvivor,
  partitionMeters,
  shadowedChannelIds,
  mergeAccounts,
} from '../../core/merge-accounts';
import { enforceMeterCap } from '../../core/meter-cap';
import { Db, schema } from '../../db';
import { USER_OWNED } from '../../db/ownership';
import { getTableConfig } from 'drizzle-orm/pg-core';

type Row = Record<string, unknown>;

// enforceMeterCap reads the account's override before counting meters, so the
// fake has to answer both selects: the users row, then the active meters.
function fakeDb(activeMeters: { id: number }[], meterLimit: number | null = null) {
  let updated = false;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows: unknown[] = table === schema.meters ? activeMeters : [{ meterLimit }];
          const p = Promise.resolve(rows) as Promise<unknown[]> & {
            orderBy: () => Promise<unknown[]>;
          };
          p.orderBy = async () => rows;
          return p;
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          updated = true;
        },
      }),
    }),
  } as unknown as Db;
  return { db, wasUpdated: () => updated };
}

describe('enforceMeterCap', () => {
  it('pauses meters beyond the free cap and reports the count', async () => {
    const { db, wasUpdated } = fakeDb([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await enforceMeterCap(db, 7, 'free')).toBe(2); // free cap is 1
    expect(wasUpdated()).toBe(true);
  });

  it('does nothing when within the cap', async () => {
    const { db, wasUpdated } = fakeDb([{ id: 1 }]);
    expect(await enforceMeterCap(db, 7, 'free')).toBe(0);
    expect(wasUpdated()).toBe(false);
  });

  it('keeps everything on an unlimited plan', async () => {
    const { db } = fakeDb([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(await enforceMeterCap(db, 7, 'business')).toBe(0);
  });

  it('honors an operator override above the plan default', async () => {
    // free caps at 1, but this account is comped to 3 - only the 4th is paused
    const { db } = fakeDb([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], 3);
    expect(await enforceMeterCap(db, 7, 'free')).toBe(1);
  });

  it('honors an operator override below the plan default', async () => {
    // business is unlimited, but this account is pinned to 1
    const { db } = fakeDb([{ id: 1 }, { id: 2 }, { id: 3 }], 1);
    expect(await enforceMeterCap(db, 7, 'business')).toBe(2);
  });
});

describe('chooseSurvivor', () => {
  const web = { id: 1, hasSubscription: false };
  const bot = { id: 2, hasSubscription: false };

  it('keeps the bot account when only it has a plan', () => {
    expect(chooseSurvivor(web, { ...bot, hasSubscription: true })).toEqual({
      survivorId: 2,
      loserId: 1,
    });
  });

  it('keeps the web account when only it has a plan', () => {
    expect(chooseSurvivor({ ...web, hasSubscription: true }, bot)).toEqual({
      survivorId: 1,
      loserId: 2,
    });
  });

  it('defaults to the web account on a tie (email is the durable login)', () => {
    expect(chooseSurvivor(web, bot)).toEqual({ survivorId: 1, loserId: 2 });
    expect(
      chooseSurvivor({ ...web, hasSubscription: true }, { ...bot, hasSubscription: true })
    ).toEqual({ survivorId: 1, loserId: 2 });
  });
});

describe('partitionMeters', () => {
  const mk = (id: number, meterNo: string) => ({
    id,
    provider: 'desco',
    accountNo: 'A1',
    meterNo,
  });

  it('drops meters the survivor already has and moves the rest', () => {
    const survivor = [mk(1, 'M1')];
    const loser = [mk(2, 'M1'), mk(3, 'M2')];
    const { dupIds, moveIds } = partitionMeters(survivor, loser);
    expect(dupIds).toEqual([2]); // same provider+account+meter as survivor's M1
    expect(moveIds).toEqual([3]);
  });
});

// A recording fake with transaction support: canned SELECT results per table are
// consumed in call order, writes are recorded. Mirrors the link-identity fake but
// covers the full mergeAccounts transaction (the FK-safe identity reconciliation).
function mergeFakeDb(queues: {
  users: Row[][];
  meters: Row[][];
  channels: Row[][];
  identities: Row[][];
}) {
  const idx: Record<string, number> = { users: 0, meters: 0, channels: 0, identities: 0 };
  const inserts: { table: unknown; values: Row }[] = [];
  const updates: { table: unknown; values: Row }[] = [];
  const deletes: { table: unknown }[] = [];
  type TableKey = 'users' | 'meters' | 'channels' | 'identities';
  const keyOf = (t: unknown): TableKey | null =>
    t === schema.users
      ? 'users'
      : t === schema.meters
        ? 'meters'
        : t === schema.channels
          ? 'channels'
          : t === schema.identities
            ? 'identities'
            : null;
  const pull = (t: unknown): Row[] => {
    const k = keyOf(t);
    if (!k) return [];
    return (queues[k] ?? [])[idx[k]++] ?? [];
  };
  const handle = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = pull(table);
          const p = Promise.resolve(rows) as Promise<Row[]> & { orderBy: () => Promise<Row[]> };
          p.orderBy = async () => rows;
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        inserts.push({ table, values });
        return { then: (resolve: (v: unknown) => void) => resolve(undefined) };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({ where: async () => void updates.push({ table, values }) }),
    }),
    delete: (table: unknown) => ({ where: async () => void deletes.push({ table }) }),
  };
  const db = {
    ...handle,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(handle),
  } as unknown as Db;
  return { db, inserts, updates, deletes };
}

describe('mergeAccounts', () => {
  it('moves the loser identity rows to the survivor, then deletes the loser user', async () => {
    // Identities are the source of truth: the loser (a telegram account) holds a
    // provider the survivor (a web/email account) lacks, so its identity row
    // repoints to the survivor. The user row is deleted only after, so its
    // ON DELETE no action FK stays satisfied.
    const survivor = { id: 1, plan: 'free' };
    const loser = { id: 2, plan: 'free' };
    const { db, updates, deletes } = mergeFakeDb({
      users: [[survivor], [loser]],
      meters: [[], [], []], // survivor, loser, then enforceMeterCap's active list
      channels: [[], []],
      identities: [
        [{ id: 10, userId: 1, provider: 'email', providerUid: 'web@x.com' }], // survivor's
        [{ id: 20, userId: 2, provider: 'telegram', providerUid: '555' }], // loser's, moves over
        [{ id: 10, userId: 1, provider: 'email', providerUid: 'web@x.com' }], // survivor email lookup
      ],
    });

    expect(await mergeAccounts(db, 1, 2)).toBe('merged');

    // the loser's telegram identity repoints to the survivor (no legacy column write)
    expect(updates.find(u => u.table === schema.identities)?.values).toEqual({ userId: 1 });
    // only the merged plan is stamped on the survivor user row
    expect(updates.find(u => u.table === schema.users)?.values).toEqual({ plan: 'free' });
    // and the loser user row is gone
    expect(deletes.some(d => d.table === schema.users)).toBe(true);
  });

  // The behavioral half of the ownership registry. ownership.test.ts pins the
  // FK *structure*; nothing pinned that merge actually acts on each table it
  // claims to own - which is how identities sat in the registry, marked
  // repointOnMerge, while merge never touched it (a live FK violation).
  it('writes to every user-keyed table the registry says it repoints', async () => {
    const survivor = { id: 1, plan: 'free' };
    const loser = { id: 2, plan: 'free' };
    const { db, updates, deletes } = mergeFakeDb({
      users: [[survivor], [loser]],
      // loser holds a meter the survivor lacks, so the meters repoint fires
      meters: [[], [{ id: 30, provider: 'desco', accountNo: 'A1', meterNo: 'M1' }], []],
      channels: [[], []],
      identities: [
        [], // survivor has none
        [{ id: 20, userId: 2, provider: 'telegram', providerUid: '555' }], // loser's, moves -> identities touched
        [], // no survivor email identity
      ],
    });

    expect(await mergeAccounts(db, 1, 2)).toBe('merged');

    const touched = new Set([...updates, ...deletes].map(w => w.table));
    const missed = USER_OWNED.filter(
      o => o.repointOnMerge && o.userId && !touched.has(o.table)
    ).map(o => getTableConfig(o.table).name);
    // If this fails: mergeAccounts has to handle the new table (follow the user,
    // or clear rows that must not outlive the loser) before it can be registered.
    expect(missed).toEqual([]);
  });
});

describe('shadowedChannelIds', () => {
  const ch = (id: number, type: string, address: string) => ({ id, type, address });

  it('shadows a loser channel the survivor already has (same type+address)', () => {
    const survivor = [ch(1, 'email', 'A@B.com')];
    const loser = [ch(2, 'email', 'a@b.com'), ch(3, 'email', 'other@x.com')];
    // case-insensitive on address; the different address moves untouched
    expect(shadowedChannelIds(survivor, loser)).toEqual([2]);
  });

  it('treats any second telegram row as a duplicate regardless of address', () => {
    // regression: post-merge there is one chat id; a second telegram row with
    // the loser's old chat id would make the dispatcher's enable-gate
    // nondeterministic (it reads a single row)
    const survivor = [ch(1, 'telegram', '111')];
    const loser = [ch(2, 'telegram', '222')];
    expect(shadowedChannelIds(survivor, loser)).toEqual([2]);
  });

  it('shadows nothing when the survivor has no overlapping channels', () => {
    const survivor = [ch(1, 'email', 'a@b.com')];
    const loser = [ch(2, 'discord-dm', '999'), ch(3, 'sms', '+8801700000000')];
    expect(shadowedChannelIds(survivor, loser)).toEqual([]);
  });
});
