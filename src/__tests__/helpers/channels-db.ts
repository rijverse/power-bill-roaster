import { Db } from '../../db';

// A fake db for the Dispatcher suites. The dispatcher's only reads are the
// channel rows and the SMS monthly-budget count, and its only write is the
// alerts_log row - so that's all this models.
//
// It used to have to recover the queried channel type by walking the drizzle
// WHERE clause, because the dispatcher issued one typed SELECT per channel. It
// now issues a single `WHERE user_id = ?` and filters in memory, so the fake just
// hands back every row and lets the real filtering logic run - which is both
// simpler and a truer test.

export type ChannelType = 'telegram' | 'email' | 'sms' | 'discord' | 'discord-dm';

export interface FakeChannel {
  id: number;
  type: ChannelType;
  address: string;
  enabled: boolean;
  verified: boolean;
}

/** A channel row; enabled + verified unless you say otherwise. */
export function channel(p: Partial<FakeChannel> & { id: number; type: ChannelType }): FakeChannel {
  return { address: `addr-${p.id}`, enabled: true, verified: true, ...p };
}

export interface FakeDbOptions {
  /** What the alerts_log $count returns - the SMS monthly-budget probe. */
  smsUsedThisMonth?: number;
  /** Every alerts_log row the dispatcher writes lands here. */
  log?: Record<string, unknown>[];
  /** Counts channel SELECTs, so a test can pin how many the dispatcher issues. */
  selects?: { count: number };
}

export function fakeChannelsDb(channels: FakeChannel[], opts: FakeDbOptions = {}): Db {
  return {
    select: () => {
      if (opts.selects) {
        opts.selects.count++;
      }
      return {
        from: () => ({
          where: async () => channels,
        }),
      };
    },
    $count: async () => opts.smsUsedThisMonth ?? 0,
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        opts.log?.push(row);
      },
    }),
  } as unknown as Db;
}
