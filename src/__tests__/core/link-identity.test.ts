import { linkIdentity, unlinkIdentity, retireStaleEmailChannels } from '../../core/identities';
import { Db, schema } from '../../db';

// linkIdentity / unlinkIdentity against a recording fake (the house pattern from
// web/attach-email.test.ts): each table has a queue of canned SELECT results,
// consumed in call order, and inserts/updates/deletes are recorded for assertion.

type Table = unknown;
type Row = Record<string, unknown>;

interface Queues {
  identities?: Row[][];
  users?: Row[][];
  channels?: Row[][];
  meters?: Row[][];
}

function keyOf(table: Table): keyof Queues | null {
  if (table === schema.identities) return 'identities';
  if (table === schema.users) return 'users';
  if (table === schema.channels) return 'channels';
  if (table === schema.meters) return 'meters';
  return null;
}

function fakeDb(queues: Queues) {
  const idx: Record<string, number> = { identities: 0, users: 0, channels: 0, meters: 0 };
  const inserts: { table: Table; values: Row }[] = [];
  const updates: { table: Table; values: Row }[] = [];
  const deletes: { table: Table }[] = [];
  const pull = (table: Table): Row[] => {
    const key = keyOf(table);
    if (!key) return [];
    return (queues[key] ?? [])[idx[key]++] ?? [];
  };
  const db = {
    select: () => ({
      from: (table: Table) => {
        const builder = {
          innerJoin: () => builder,
          where: async () => pull(table),
        };
        return builder;
      },
    }),
    insert: (table: Table) => ({
      values: (values: Row) => {
        inserts.push({ table, values });
        return {
          returning: async () => [{ id: 1, ...values }],
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: Table) => ({
      set: (values: Row) => ({ where: async () => void updates.push({ table, values }) }),
    }),
    delete: (table: Table) => ({ where: async () => void deletes.push({ table }) }),
  } as unknown as Db;
  return { db, inserts, updates, deletes };
}

describe('linkIdentity', () => {
  it('links a free telegram identity: inserts the identity and its channel', async () => {
    const { db, inserts, updates } = fakeDb({
      identities: [[], []], // by-uid: none; by-user+provider: none
      channels: [[]], // ensureChannel: no existing row
    });
    const res = await linkIdentity(db, 7, { provider: 'telegram', chatId: 100 });
    expect(res).toEqual({ status: 'linked' });
    expect(inserts.find(i => i.table === schema.identities)?.values).toMatchObject({
      userId: 7,
      provider: 'telegram',
      providerUid: '100',
      verified: true,
    });
    expect(inserts.find(i => i.table === schema.channels)?.values).toMatchObject({
      type: 'telegram',
      address: '100',
      verified: true,
    });
    // identities are the source of truth now - no users-column write
    expect(updates.find(u => u.table === schema.users)).toBeUndefined();
  });

  it('reports already when the target already owns the identity', async () => {
    const { db, inserts } = fakeDb({
      identities: [[{ id: 1, userId: 7, provider: 'discord', providerUid: 'abc' }]],
      channels: [[{ id: 5, verified: true, enabled: true }]],
    });
    const res = await linkIdentity(db, 7, { provider: 'discord', discordUserId: 'abc' });
    expect(res).toEqual({ status: 'already' });
    expect(inserts.find(i => i.table === schema.identities)).toBeUndefined();
  });

  it('reports needs-merge with summaries when another account owns the identity', async () => {
    const { db, inserts } = fakeDb({
      identities: [[{ id: 1, userId: 9, provider: 'telegram', providerUid: '100' }]],
      meters: [[{ id: 1 }, { id: 2 }], [{ id: 3 }]], // me has 2, other has 1
      users: [[{ id: 7, plan: 'free' }], [{ id: 9, plan: 'plus' }]],
    });
    const res = await linkIdentity(db, 7, { provider: 'telegram', chatId: 100 });
    expect(res).toMatchObject({
      status: 'needs-merge',
      otherUserId: 9,
      summary: {
        me: { userId: 7, meterCount: 2, plan: 'free' },
        other: { userId: 9, meterCount: 1, plan: 'plus' },
      },
    });
    expect(inserts.find(i => i.table === schema.identities)).toBeUndefined();
  });

  it('reports provider-conflict when the target has a different id for that provider', async () => {
    const { db } = fakeDb({
      identities: [
        [], // by-uid: the new id is free
        [{ id: 1, userId: 7, provider: 'telegram', providerUid: '999' }], // target already has a telegram
      ],
    });
    const res = await linkIdentity(db, 7, { provider: 'telegram', chatId: 100 });
    expect(res).toEqual({ status: 'provider-conflict', existingUid: '999' });
  });

  it('retires stale email rows when linking an email identity', async () => {
    const { db, updates, inserts } = fakeDb({
      identities: [[], []],
      channels: [[]],
    });
    const res = await linkIdentity(db, 7, { provider: 'email', email: 'New@Example.com' });
    expect(res).toEqual({ status: 'linked' });
    // the identity uid is lower-cased
    expect(inserts.find(i => i.table === schema.identities)?.values).toMatchObject({
      provider: 'email',
      providerUid: 'new@example.com',
    });
    // a channels update runs (the retire-stale pass turns other email rows off)
    expect(updates.some(u => u.table === schema.channels && u.values.enabled === false)).toBe(true);
  });
});

describe('unlinkIdentity', () => {
  it('refuses to remove the last identity', async () => {
    const { db, deletes } = fakeDb({
      identities: [[{ id: 1, userId: 7, provider: 'telegram', providerUid: '100' }]],
    });
    expect(await unlinkIdentity(db, 7, 'telegram')).toEqual({ status: 'last-identity' });
    expect(deletes).toHaveLength(0);
  });

  it('returns not-found when the user has no identity for that provider', async () => {
    const { db } = fakeDb({
      identities: [
        [
          { id: 1, userId: 7, provider: 'telegram', providerUid: '100' },
          { id: 2, userId: 7, provider: 'email', providerUid: 'a@b.com' },
        ],
      ],
    });
    expect(await unlinkIdentity(db, 7, 'discord')).toEqual({ status: 'not-found' });
  });

  it('deletes the identity and disables the channel', async () => {
    const { db, deletes, updates } = fakeDb({
      identities: [
        [
          { id: 1, userId: 7, provider: 'telegram', providerUid: '100' },
          { id: 2, userId: 7, provider: 'email', providerUid: 'a@b.com' },
        ],
      ],
    });
    expect(await unlinkIdentity(db, 7, 'telegram')).toEqual({ status: 'unlinked' });
    expect(deletes.some(d => d.table === schema.identities)).toBe(true);
    // no users-column write - the identity row is the source of truth
    expect(updates.find(u => u.table === schema.users)).toBeUndefined();
    expect(updates.some(u => u.table === schema.channels && u.values.enabled === false)).toBe(true);
  });
});

describe('retireStaleEmailChannels', () => {
  it('turns off email rows other than the kept address', async () => {
    const { db, updates } = fakeDb({});
    await retireStaleEmailChannels(db, 7, 'keep@x.com');
    expect(updates).toEqual([{ table: schema.channels, values: { enabled: false } }]);
  });
});
