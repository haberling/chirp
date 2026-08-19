import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { rateLimits } from "../db/schema";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Sustained/daily tier (PLAN.md "Security: Rate limiting") — the native
// `ratelimit` binding tops out at 60s windows, so this covers the 24h cap
// via a D1-backed counter keyed on ip_hash. Returns false (and leaves the
// counter untouched) once the window's count is already at max; otherwise
// increments and returns true. A window older than 24h resets to a fresh
// count of 1 rather than trying to prorate it.
export async function checkAndIncrementSustainedRateLimit(
  db: ReturnType<typeof createDb>,
  ipHash: string,
  dailyMax: number,
): Promise<boolean> {
  const now = Date.now();
  const existing = await db.select().from(rateLimits).where(eq(rateLimits.key, ipHash)).get();

  if (!existing || now - existing.windowStart.getTime() >= WINDOW_MS) {
    await db
      .insert(rateLimits)
      .values({ key: ipHash, windowStart: new Date(now), count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { windowStart: new Date(now), count: 1 },
      });
    return true;
  }

  if (existing.count >= dailyMax) {
    return false;
  }

  await db
    .update(rateLimits)
    .set({ count: existing.count + 1 })
    .where(eq(rateLimits.key, ipHash));
  return true;
}
