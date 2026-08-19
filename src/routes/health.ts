import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Bindings } from "../bindings";
import { createDb } from "../db/client";
import { moderationBudget } from "../db/schema";

const REQUIRED_SECRETS = [
  "ANTHROPIC_API_KEY",
  "TURNSTILE_SECRET",
  "ADMIN_TOKEN",
  "IP_HASH_SALT",
  "COMMENTER_ID_SALT",
] as const;

export const health = new Hono<{ Bindings: Bindings }>();

health.get("/health", async (c) => {
  const missing: string[] = [];
  for (const key of REQUIRED_SECRETS) {
    if (!c.env[key]) missing.push(key);
  }
  if (!c.env.RATE_LIMITER) missing.push("RATE_LIMITER");
  const configOk = missing.length === 0;

  let dbOk = true;
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    dbOk = false;
  }

  if (!dbOk || !configOk) {
    return c.json(
      {
        status: "error",
        db: dbOk ? "ok" : "error",
        config: configOk ? "ok" : "error",
        missing,
      },
      503,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const db = createDb(c.env.DB);
  const row = await db
    .select({ llmCalls: moderationBudget.llmCalls })
    .from(moderationBudget)
    .where(eq(moderationBudget.date, today))
    .get();
  const tripped = (row?.llmCalls ?? 0) >= Number(c.env.LLM_DAILY_CALL_CAP);

  return c.json({
    status: "ok",
    db: "ok",
    config: "ok",
    llmCircuitBreaker: tripped ? "tripped" : "ok",
  });
});
