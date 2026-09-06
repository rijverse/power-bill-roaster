import { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// The one list of tables that hold a user's data, and how they hang off the user.
//
// eraseUser and mergeAccounts both need it, and they used to each carry their own
// hand-written copy - so a new user-owned table had to be remembered twice, and
// history says it gets forgotten (pending_alerts, payments, the Discord identity
// column). `__tests__/db/ownership.test.ts` reflects over the schema's foreign
// keys and fails if a table is missing from this list, which is the part a hand
// list can't do for you.
//
// Not ON DELETE CASCADE, deliberately: cascade does nothing for mergeAccounts
// (which re-points FKs rather than deleting the parent), it would need the
// riskiest migration on the list for zero behavior change, and it trades a loud
// FK error for silent data loss in exactly the tables backing an erasure promise.

export interface OwnedTable {
  table: AnyPgTable;
  /** The FK to users.id, when rows are keyed by user. */
  userId?: AnyPgColumn;
  /** The FK to meters.id, when rows are keyed by meter. */
  meterId?: AnyPgColumn;
  /**
   * On merge, do these rows follow the user to the survivor? False means they
   * belong to a meter and die with a duplicate one (readings of a meter the
   * survivor already has are not worth reconciling).
   */
  repointOnMerge: boolean;
}

/**
 * Children first: an entry may only appear after everything that references it.
 * `users` itself is not listed - it is always deleted last, by eraseUser.
 *
 * The order is asserted by the ownership test, so it can't rot silently.
 */
export const USER_OWNED: OwnedTable[] = [
  // FKs meters AND channels, so it has to precede both.
  { table: schema.alertsLog, meterId: schema.alertsLog.meterId, repointOnMerge: false },
  { table: schema.alertState, meterId: schema.alertState.meterId, repointOnMerge: false },
  { table: schema.readings, meterId: schema.readings.meterId, repointOnMerge: false },
  {
    table: schema.pendingAlerts,
    meterId: schema.pendingAlerts.meterId,
    userId: schema.pendingAlerts.userId,
    repointOnMerge: true,
  },
  { table: schema.meters, userId: schema.meters.userId, repointOnMerge: true },
  { table: schema.channels, userId: schema.channels.userId, repointOnMerge: true },
  // Login identities. Merge does NOT repoint these row-for-row: it deletes the
  // loser's and rebuilds the survivor's from the merged identity columns, because
  // the (user_id, provider) unique makes a blind repoint collide whenever both
  // sides hold the same provider. Flagged repointOnMerge because merge owns them
  // (they must not outlive the loser); this entry also drives eraseUser. Nothing
  // references identities, so its position among the user-keyed tables is free.
  { table: schema.identities, userId: schema.identities.userId, repointOnMerge: true },
  // FKs users AND subscriptions, so it has to precede subscriptions.
  { table: schema.payments, userId: schema.payments.userId, repointOnMerge: true },
  { table: schema.subscriptions, userId: schema.subscriptions.userId, repointOnMerge: true },
];

/**
 * Tables whose rows die with a duplicate meter on merge (they hang off the meter,
 * not the user), children-first.
 */
export const METER_OWNED = USER_OWNED.filter(o => o.meterId !== undefined);
