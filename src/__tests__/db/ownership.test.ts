import { AnyPgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
import { USER_OWNED } from '../../db/ownership';

// The test the hand-written table lists in eraseUser/mergeAccounts could never be:
// it reflects over the schema's actual foreign keys, so a NEW user-owned table
// fails here until someone registers it. History says that's the failure mode -
// pending_alerts and payments were both forgotten once, and a forgotten table
// means either a crash on erase (FK violation) or, worse, data that outlives the
// account it belongs to.

/** Every exported drizzle table in the schema, with its reflected config. */
function tables(): { name: string; table: AnyPgTable }[] {
  return Object.values(schema)
    .map(value => {
      const table = value as AnyPgTable;
      try {
        return { name: getTableConfig(table).name, table };
      } catch {
        return null; // not a table (a type, an index, a helper)
      }
    })
    .filter((t): t is { name: string; table: AnyPgTable } => t !== null);
}

function foreignKeysOf(table: AnyPgTable) {
  return getTableConfig(table).foreignKeys.map(fk => {
    const ref = fk.reference();
    return {
      parent: getTableConfig(ref.foreignTable).name,
      column: ref.columns[0]?.name ?? '',
    };
  });
}

const OWNED_NAMES = new Set(USER_OWNED.map(o => getTableConfig(o.table).name));

describe('user-owned table registry', () => {
  it('covers every table that FKs users or meters', () => {
    const missing: string[] = [];
    for (const { name, table } of tables()) {
      const ownsUserData = foreignKeysOf(table).some(
        fk => fk.parent === 'users' || fk.parent === 'meters'
      );
      if (ownsUserData && !OWNED_NAMES.has(name)) {
        missing.push(name);
      }
    }
    // If this fails, add the table to USER_OWNED (children-first) and make sure
    // mergeAccounts knows whether its rows follow the user or die with the meter.
    expect(missing).toEqual([]);
  });

  it('registers the right FK column for each entry', () => {
    for (const owned of USER_OWNED) {
      const fks = foreignKeysOf(owned.table);
      const name = getTableConfig(owned.table).name;
      if (owned.userId) {
        expect(fks.some(fk => fk.parent === 'users')).toBe(true);
      }
      if (owned.meterId) {
        expect(fks.some(fk => fk.parent === 'meters')).toBe(true);
      }
      // an entry has to be keyed by something
      expect(Boolean(owned.userId || owned.meterId)).toBe(true);
      expect(name).toBeTruthy();
    }
  });

  it('is ordered children-first, so the delete order is provably FK-safe', () => {
    const order = USER_OWNED.map(o => getTableConfig(o.table).name);
    for (let i = 0; i < USER_OWNED.length; i++) {
      const name = order[i];
      const laterTables = new Set(order.slice(i + 1));
      for (const fk of foreignKeysOf(USER_OWNED[i].table)) {
        // A table must not be deleted before something it points at is still
        // needed by a table listed after it... i.e. nothing earlier may be FK'd
        // BY something later. Concretely: this table's parents must not appear
        // earlier in the list.
        const parentsEarlier = order.slice(0, i).includes(fk.parent);
        expect({ table: name, fkTo: fk.parent, parentDeletedFirst: parentsEarlier }).toEqual({
          table: name,
          fkTo: fk.parent,
          parentDeletedFirst: false,
        });
        expect(laterTables.has(fk.parent) || fk.parent === 'users').toBe(true);
      }
    }
  });

  it('counts 11 foreign keys - a 12th forces a decision here', () => {
    // The old note said 7; it undercounted. Pinning the real number means a new
    // FK anywhere in the schema trips this test and gets looked at.
    const total = tables().reduce((n, t) => n + foreignKeysOf(t.table).length, 0);
    expect(total).toBe(11);
  });

  it('leaves admin_audit deliberately un-FK-ed, so it outlives an erased account', () => {
    // The audit trail must survive the user it describes; an FK would make erase
    // impossible. If someone adds one, this fails loudly instead of silently.
    expect(foreignKeysOf(schema.adminAudit)).toEqual([]);
  });

  it('pins the identity columns on users, because reflection cannot infer intent', () => {
    // A 3rd platform identity column would have to be handled in mergedIdentity()
    // too, and no FK reflection can tell you that - so the column set is pinned.
    // If this fails: add the column to mergedIdentity() if it identifies the user.
    const columns = Object.keys(
      getTableConfig(schema.users).columns.reduce<Record<string, true>>(
        (acc, c) => ({ ...acc, [c.name]: true }),
        {}
      )
    );
    expect(columns.sort()).toEqual(
      [
        'id',
        'telegram_chat_id',
        'discord_user_id',
        'email',
        'plan',
        'tone_pref',
        'quiet_start',
        'quiet_end',
        'created_at',
      ].sort()
    );
  });
});
