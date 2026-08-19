import { Hono } from "hono";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Bindings } from "../bindings";
import { createDb } from "../db/client";
import { comments, moderationBudget, rejectedLog } from "../db/schema";
import { handlePreflight, publicCors, requireAllowedOrigin } from "../middleware/cors";
import { getConnectingIp, hashIp } from "../lib/ip-hash";
import { hashCommenterGuid } from "../lib/commenter-id";
import { validateCommentInput } from "../lib/validate-comment";
import { checkAndIncrementSustainedRateLimit } from "../lib/rate-limit";
import { verifyTurnstile } from "../lib/turnstile";
import { moderateComment, MODERATION_UNAVAILABLE, SERVICE_PAUSED } from "../lib/moderation";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const commentsRoute = new Hono<{ Bindings: Bindings }>();

commentsRoute.use("/comments", publicCors);

// Every row in `comments` is already approved — rejections never make it
// past moderation into this table (they go to `rejected_log` instead, see
// PLAN.md's moderation flow), so there's no status filter to apply here.
commentsRoute.get("/comments", async (c) => {
  const pageId = c.req.query("page");
  if (!pageId) {
    return c.json({ error: "missing required 'page' query param" }, 400);
  }

  const limitParam = Number(c.req.query("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const cursorParam = c.req.query("cursor");
  let cursor: number | undefined;
  if (cursorParam !== undefined) {
    cursor = Number(cursorParam);
    if (!Number.isFinite(cursor)) {
      return c.json({ error: "invalid 'cursor' query param" }, 400);
    }
  }

  const db = createDb(c.env.DB);
  const where =
    cursor !== undefined
      ? and(eq(comments.pageId, pageId), gt(comments.createdAt, new Date(cursor)))
      : eq(comments.pageId, pageId);

  const rows = await db
    .select({
      id: comments.id,
      pageId: comments.pageId,
      parentId: comments.parentId,
      authorName: comments.authorName,
      body: comments.body,
      createdAt: comments.createdAt,
      commenterId: comments.commenterId,
    })
    .from(comments)
    .where(where)
    .orderBy(asc(comments.createdAt))
    .limit(limit)
    .all();

  const lastRow = rows.at(-1);
  const nextCursor = rows.length === limit && lastRow ? lastRow.createdAt.getTime() : null;

  return c.json({
    comments: rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
    nextCursor,
  });
});

commentsRoute.options("/comments", (c) => handlePreflight(c));

// The full submit pipeline, PLAN.md "Architecture": cheapest checks first,
// each stage rejects before the next (more expensive) one ever runs.
commentsRoute.post("/comments", requireAllowedOrigin, async (c) => {
  // 2. Field validation + honeypot
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid submission" }, 400);
  }
  const maxBodyLength = Number(c.env.COMMENT_MAX_LENGTH) || 500;
  const validated = validateCommentInput(raw, maxBodyLength);
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400);
  }
  const { pageId, parentId, authorName, authorEmail, body, commenterGuid, turnstileToken } = validated.value;

  const db = createDb(c.env.DB);

  if (parentId) {
    const parent = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.pageId, pageId)))
      .get();
    if (!parent) {
      return c.json({ error: "parentId does not resolve to an existing comment on this page" }, 400);
    }
  }

  const ip = getConnectingIp(c.req.raw.headers);
  const ipHash = await hashIp(ip, c.env.IP_HASH_SALT);
  const commenterId = await hashCommenterGuid(commenterGuid, c.env.COMMENTER_ID_SALT);

  // 3. Duplicate-submit dedupe
  const dupWindowMs = (Number(c.env.DUPLICATE_WINDOW_S) || 60) * 1000;
  const dupCutoff = new Date(Date.now() - dupWindowMs);
  const duplicate = await db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.pageId, pageId),
        eq(comments.ipHash, ipHash),
        eq(comments.body, body),
        gt(comments.createdAt, dupCutoff),
      ),
    )
    .get();
  if (duplicate) {
    return c.json({ error: "duplicate submission" }, 409);
  }

  // 4. Burst rate limit (native `ratelimit` binding)
  const burst = await c.env.RATE_LIMITER.limit({ key: ipHash });
  if (!burst.success) {
    return c.json({ error: "rate limited" }, 429);
  }

  // 5. Sustained rate limit (D1, 24h tier)
  const dailyMax = Number(c.env.RATE_LIMIT_DAILY_MAX) || 20;
  const withinSustained = await checkAndIncrementSustainedRateLimit(db, ipHash, dailyMax);
  if (!withinSustained) {
    return c.json({ error: "rate limited" }, 429);
  }

  // 6. Turnstile verification
  const turnstileOk = await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET, ip);
  if (!turnstileOk) {
    return c.json({ error: "turnstile verification failed" }, 403);
  }

  // 7. LLM spend circuit breaker check
  const today = new Date().toISOString().slice(0, 10);
  const budgetRow = await db
    .select({ llmCalls: moderationBudget.llmCalls })
    .from(moderationBudget)
    .where(eq(moderationBudget.date, today))
    .get();
  const dailyCap = Number(c.env.LLM_DAILY_CALL_CAP) || 5000;
  if ((budgetRow?.llmCalls ?? 0) >= dailyCap) {
    return c.json({ status: "rejected", category: SERVICE_PAUSED });
  }

  // 8. LLM moderation call — budget is incremented right before the call
  // attempt (PLAN.md: "so even a call that errors out still counts — no
  // free retry storms"), before we know the outcome.
  await db
    .insert(moderationBudget)
    .values({ date: today, llmCalls: 1 })
    .onConflictDoUpdate({
      target: moderationBudget.date,
      set: { llmCalls: sql`${moderationBudget.llmCalls} + 1` },
    });

  const verdict = await moderateComment({
    policy: c.env.MODERATION_POLICY,
    authorName,
    body,
    apiKey: c.env.ANTHROPIC_API_KEY,
    model: c.env.MODERATION_MODEL,
  });

  if (!verdict) {
    // The moderation call itself failed (network/parse/malformed
    // response) — distinct from the circuit breaker above: this is a
    // vendor/connectivity problem, not a volume cap, so it gets its own
    // category. Fail closed rather than risk auto-publishing content that
    // was never actually reviewed.
    return c.json({ status: "rejected", category: MODERATION_UNAVAILABLE });
  }

  // 9. Insert-or-log
  const now = new Date();

  if (verdict.verdict === "reject") {
    await db.insert(rejectedLog).values({
      id: crypto.randomUUID(),
      pageId,
      authorName,
      body,
      category: verdict.category,
      reason: verdict.reason,
      createdAt: now,
    });
    // Ring buffer: trim to the last 100 rows, site-wide (not enforced by
    // the schema — this insert path owns the trim).
    await db.run(
      sql`DELETE FROM rejected_log WHERE id NOT IN (SELECT id FROM rejected_log ORDER BY created_at DESC LIMIT 100)`,
    );

    return c.json({ status: "rejected", category: verdict.category });
  }

  const id = crypto.randomUUID();
  await db.insert(comments).values({
    id,
    pageId,
    parentId,
    authorName,
    authorEmail,
    body,
    createdAt: now,
    ipHash,
    commenterId,
  });

  return c.json(
    {
      status: "approved",
      comment: {
        id,
        pageId,
        parentId,
        authorName,
        body,
        createdAt: now.getTime(),
        commenterId,
      },
    },
    201,
  );
});
