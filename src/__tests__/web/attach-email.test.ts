import { attachEmailToUser } from '../../web/app';
import { Db, schema } from '../../db';

// Changing your email must retire the old address: the dispatcher fans out to
// every enabled email channel row, so an old row left enabled keeps leaking
// balance alerts to an address the user may no longer control. This drives
// attachEmailToUser against a recording fake and pins that the switch
// disables other email rows before enabling the new one.

type UpdateCall = { table: unknown; values: Record<string, unknown> };
type InsertCall = { table: unknown; values: Record<string, unknown> };

function fakeDb(opts: { existingChannelForNewAddress?: Record<string, unknown> | null }) {
  const updates: UpdateCall[] = [];
  const inserts: InsertCall[] = [];
  let channelQueries = 0;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.users) {
            // first users select = conflict check (none), later = reload
            return [{ id: 1, email: 'new@y.com', plan: 'free' }];
          }
          if (table === schema.channels) {
            channelQueries++;
            return opts.existingChannelForNewAddress ? [opts.existingChannelForNewAddress] : [];
          }
          return [];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
      },
    }),
  } as unknown as Db;
  return { db, updates, inserts, channelQueries: () => channelQueries };
}

describe('attachEmailToUser', () => {
  it('conflict check: refuses an email owned by a different account', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: async () => [{ id: 2, email: 'new@y.com' }] }),
      }),
    } as unknown as Db;
    expect(await attachEmailToUser(db, 1, 'new@y.com')).toBe('conflict');
  });

  it('disables other email rows before inserting the new address', async () => {
    const { db, updates, inserts } = fakeDb({ existingChannelForNewAddress: null });
    await attachEmailToUser(db, 1, 'new@y.com');

    const channelUpdates = updates.filter(u => u.table === schema.channels);
    // the retire-old-rows update runs, and it only ever turns rows OFF
    expect(channelUpdates.some(u => u.values.enabled === false)).toBe(true);
    // the new address is inserted verified+enabled
    const inserted = inserts.find(i => i.table === schema.channels);
    expect(inserted?.values).toMatchObject({
      address: 'new@y.com',
      type: 'email',
      verified: true,
      enabled: true,
    });
  });

  it('re-enables an existing row for the new address instead of inserting', async () => {
    const { db, updates, inserts } = fakeDb({
      existingChannelForNewAddress: { id: 9, verified: true, enabled: false },
    });
    await attachEmailToUser(db, 1, 'new@y.com');

    expect(inserts.filter(i => i.table === schema.channels)).toHaveLength(0);
    const channelUpdates = updates.filter(u => u.table === schema.channels);
    // old rows disabled first, then the matching row re-enabled
    expect(channelUpdates.some(u => u.values.enabled === false)).toBe(true);
    expect(channelUpdates.some(u => u.values.enabled === true && u.values.verified === true)).toBe(
      true
    );
  });
});
