import {
  chooseSurvivor,
  partitionMeters,
  mergedIdentity,
  shadowedChannelIds,
} from '../../core/merge-accounts';
import { enforceMeterCap } from '../../core/meter-cap';
import { Db } from '../../db';

function fakeDb(activeMeters: { id: number }[]) {
  let updated = false;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => activeMeters }) }) }),
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

describe('mergedIdentity', () => {
  it('keeps the survivor email/discord id/plan when it has them', () => {
    expect(
      mergedIdentity(
        { email: 'a@b.com', discordUserId: '111', plan: 'plus' },
        { email: 'c@d.com', discordUserId: '222', plan: 'free' }
      )
    ).toEqual({ email: 'a@b.com', discordUserId: '111', plan: 'plus' });
  });

  it('inherits the loser email, discord id, and paid plan when the survivor lacks them', () => {
    // survivor has no email/discord and is free; the loser's identities and paid plan survive
    expect(
      mergedIdentity(
        { email: null, discordUserId: null, plan: 'free' },
        { email: 'c@d.com', discordUserId: '222', plan: 'business' }
      )
    ).toEqual({ email: 'c@d.com', discordUserId: '222', plan: 'business' });
  });

  it('never drops a discord identity in a telegram+web merge', () => {
    // regression: the survivor is a web account, the loser a telegram account
    // that had already linked Discord - the discord id must carry over
    expect(
      mergedIdentity(
        { email: 'a@b.com', discordUserId: null, plan: 'free' },
        { email: null, discordUserId: '333', plan: 'free' }
      ).discordUserId
    ).toBe('333');
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
