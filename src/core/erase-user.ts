import { eq, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';

/**
 * Permanently deletes a user and everything attached to them: meters,
 * readings, alert state, alert log, channels, subscriptions. The /delete
 * command's backend - this is the privacy policy's erasure promise.
 */
export async function eraseUser(db: Db, userId: number): Promise<void> {
  await db.transaction(async tx => {
    const meters = await tx
      .select({ id: schema.meters.id })
      .from(schema.meters)
      .where(eq(schema.meters.userId, userId));
    const meterIds = meters.map(m => m.id);

    if (meterIds.length > 0) {
      await tx.delete(schema.alertsLog).where(inArray(schema.alertsLog.meterId, meterIds));
      await tx.delete(schema.alertState).where(inArray(schema.alertState.meterId, meterIds));
      await tx.delete(schema.readings).where(inArray(schema.readings.meterId, meterIds));
      await tx.delete(schema.meters).where(inArray(schema.meters.id, meterIds));
    }
    await tx.delete(schema.channels).where(eq(schema.channels.userId, userId));
    await tx.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}
