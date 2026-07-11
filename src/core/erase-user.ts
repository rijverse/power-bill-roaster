import { eq, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { USER_OWNED } from '../db/ownership';

/**
 * Permanently deletes a user and everything attached to them. The /delete
 * command's backend - this is the privacy policy's erasure promise.
 *
 * The table list is not written out here: it comes from the USER_OWNED registry,
 * which is children-first and is reflection-tested against the schema's foreign
 * keys. A new user-owned table therefore can't be silently missed - the ownership
 * test fails until it is registered.
 */
export async function eraseUser(db: Db, userId: number): Promise<void> {
  await db.transaction(async tx => {
    const meters = await tx
      .select({ id: schema.meters.id })
      .from(schema.meters)
      .where(eq(schema.meters.userId, userId));
    const meterIds = meters.map(m => m.id);

    for (const owned of USER_OWNED) {
      // Meter-keyed rows go first (a table can be keyed by both - pending_alerts
      // is - and the union is what we want either way).
      if (owned.meterId && meterIds.length > 0) {
        await tx.delete(owned.table).where(inArray(owned.meterId, meterIds));
      }
      if (owned.userId) {
        await tx.delete(owned.table).where(eq(owned.userId, userId));
      }
    }
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
