import { eq, and, inArray } from 'drizzle-orm';
import { Db, schema } from '../db';
import { effectiveMeterLimit } from './plans';

/**
 * Enforce an account's meter cap: keep the oldest allowed active meters and pause
 * the rest. Returns how many were paused. Used on downgrade and on an account
 * merge so a lapsed or merged account can't keep more meters than it is allowed.
 *
 * `plan` is passed in because callers often know the new plan before it is
 * persisted (a downgrade computes the cap it is about to apply). The operator
 * override is read here rather than threaded through every caller, so no call
 * site can silently ignore it.
 */
export async function enforceMeterCap(db: Db, userId: number, plan: string): Promise<number> {
  const [user] = await db
    .select({ meterLimit: schema.users.meterLimit })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const cap = effectiveMeterLimit({ plan, meterLimit: user?.meterLimit ?? null });
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
