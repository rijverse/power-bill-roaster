import { eq, and, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { maxMetersFor } from './plans';

/**
 * Enforce a plan's meter cap: keep the oldest `maxMetersFor(plan)` active meters
 * and pause the rest. Returns how many were paused. Used on downgrade and on an
 * account merge so a lapsed or merged account can't keep more meters than its
 * plan allows.
 */
export async function enforceMeterCap(db: Db, userId: number, plan: string): Promise<number> {
  const cap = maxMetersFor(plan);
  const activeMeters = await db
    .select()
    .from(schema.meters)
    .where(and(eq(schema.meters.userId, userId), eq(schema.meters.active, true)))
    .orderBy(schema.meters.createdAt);
  const excess = activeMeters.slice(cap);
  if (excess.length > 0) {
    await db
      .update(schema.meters)
      .set({ active: false })
      .where(
        inArray(
          schema.meters.id,
          excess.map(m => m.id)
        )
      );
  }
  return excess.length;
}
