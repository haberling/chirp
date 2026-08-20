import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "../src/lib/ip-hash";
import {
  getComments,
  mockModerationApprove,
  mockModerationDown,
  mockModerationReject,
  mockTurnstile,
  postComment,
  postRaw,
  randomIp,
  TEST_ORIGIN,
  validCommentBody,
} from "./helpers";

// Every test below either mocks Turnstile explicitly or relies on this
// default — set once per test via beforeEach would hide which tests
// actually exercise a Turnstile failure, so each test mocks what it needs.
afterEach(async () => {
  await env.DB.prepare("DELETE FROM comments").run();
  await env.DB.prepare("DELETE FROM rejected_log").run();
  await env.DB.prepare("DELETE FROM rate_limits").run();
  await env.DB.prepare("DELETE FROM moderation_budget").run();
});

describe("POST /comments — origin / validation", () => {
  it("rejects a missing Origin with 403, before touching the DB", async () => {
    const res = await postComment(validCommentBody(), { origin: null });
    expect(res.status).toBe(403);
  });

  it("rejects a disallowed Origin with 403", async () => {
    const res = await postComment(validCommentBody(), { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid JSON body with 400", async () => {
    const res = await postRaw("not json");
    expect(res.status).toBe(400);
  });

  it("rejects a missing required field with 400", async () => {
    const res = await postComment(validCommentBody({ authorName: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a body over the configured max length with 400", async () => {
    const res = await postComment(validCommentBody({ body: "x".repeat(501) }));
    expect(res.status).toBe(400);
  });

  it("silently rejects a filled-in honeypot with the same 400 as normal validation", async () => {
    const res = await postComment(validCommentBody({ honeypot: "I am a bot" }));
    expect(res.status).toBe(400);
  });

  it("rejects a parentId that doesn't resolve to an existing comment on the page", async () => {
    const res = await postComment(validCommentBody({ parentId: "does-not-exist" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /comments — happy path", () => {
  it("approves a clean comment and makes it fetchable", async () => {
    mockTurnstile(true);
    mockModerationApprove();

    const pageId = `page-${crypto.randomUUID()}`;
    const res = await postComment(validCommentBody({ pageId, authorName: "Ada" }));
    expect(res.status).toBe(201);
    const json = await res.json<{ status: string; comment: { id: string; pageId: string } }>();
    expect(json.status).toBe("approved");
    expect(json.comment.pageId).toBe(pageId);

    const listRes = await getComments(`page=${pageId}`, { origin: TEST_ORIGIN });
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{ comments: { id: string; authorName: string }[] }>();
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0]?.authorName).toBe("Ada");
  });

  it("accepts a reply whose parentId resolves to an existing top-level comment", async () => {
    mockTurnstile(true);
    mockModerationApprove();

    const pageId = `page-${crypto.randomUUID()}`;
    const parentRes = await postComment(validCommentBody({ pageId }));
    const parent = await parentRes.json<{ comment: { id: string } }>();

    mockTurnstile(true);
    mockModerationApprove();
    const replyRes = await postComment(validCommentBody({ pageId, parentId: parent.comment.id }));
    expect(replyRes.status).toBe(201);
    const reply = await replyRes.json<{ comment: { parentId: string | null } }>();
    expect(reply.comment.parentId).toBe(parent.comment.id);
  });
});

describe("POST /comments — moderation", () => {
  it("rejects a comment the LLM flags, and logs it instead of storing it", async () => {
    mockTurnstile(true);
    mockModerationReject("spam", "looks like spam");

    const pageId = `page-${crypto.randomUUID()}`;
    const res = await postComment(validCommentBody({ pageId }));
    expect(res.status).toBe(200);
    const json = await res.json<{ status: string; category: string }>();
    expect(json).toEqual({ status: "rejected", category: "spam" });

    const listRes = await getComments(`page=${pageId}`, { origin: TEST_ORIGIN });
    const list = await listRes.json<{ comments: unknown[] }>();
    expect(list.comments).toHaveLength(0);

    const logged = await env.DB.prepare("SELECT category, reason FROM rejected_log WHERE page_id = ?")
      .bind(pageId)
      .first<{ category: string; reason: string }>();
    expect(logged?.category).toBe("spam");
  });

  it("fails closed with moderation_unavailable when the moderation call errors", async () => {
    mockTurnstile(true);
    mockModerationDown();

    const res = await postComment(validCommentBody());
    expect(res.status).toBe(200);
    const json = await res.json<{ status: string; category: string }>();
    expect(json).toEqual({ status: "rejected", category: "moderation_unavailable" });
  });

  it("never leaks the raw LLM reason to the client, only the category", async () => {
    mockTurnstile(true);
    mockModerationReject("harassment", "targets a specific commenter by name, calls them a loser");

    const res = await postComment(validCommentBody());
    const text = await res.text();
    expect(text).not.toContain("loser");
    expect(text).toContain("harassment");
  });
});

describe("POST /comments — Turnstile", () => {
  it("rejects with 403 when Turnstile verification fails", async () => {
    mockTurnstile(false);
    // No moderation mock: if the pipeline reached the LLM call despite a
    // failed Turnstile check, MSW would throw on the unhandled request and
    // fail the test loudly rather than silently passing.
    const res = await postComment(validCommentBody());
    expect(res.status).toBe(403);
  });
});

describe("POST /comments — duplicate-submit dedupe", () => {
  it("rejects an identical resubmission from the same IP within the dedupe window with 409", async () => {
    mockTurnstile(true);
    mockModerationApprove();
    const ip = randomIp();
    const body = validCommentBody({ pageId: `page-${crypto.randomUUID()}` });

    const first = await postComment(body, { ip });
    expect(first.status).toBe(201);

    // Same ip+page+body again — should be caught by dedupe before Turnstile
    // or the LLM are ever consulted (no mocks registered for this call).
    const second = await postComment(body, { ip });
    expect(second.status).toBe(409);
  });

  it("does not dedupe the same body from a different IP", async () => {
    mockTurnstile(true);
    mockModerationApprove();
    const body = validCommentBody({ pageId: `page-${crypto.randomUUID()}` });

    const first = await postComment(body, { ip: randomIp() });
    expect(first.status).toBe(201);

    mockTurnstile(true);
    mockModerationApprove();
    const second = await postComment(body, { ip: randomIp() });
    expect(second.status).toBe(201);
  });
});

describe("POST /comments — rate limiting", () => {
  it("burst-limits a single IP after the configured number of requests (409/429 before Turnstile)", async () => {
    // wrangler.test.jsonc sets the burst limiter to 3/60s. Each request
    // below has a distinct body so dedupe never intervenes first, isolating
    // this test to the burst limiter specifically.
    const ip = randomIp();
    const pageId = `page-${crypto.randomUUID()}`;

    for (let i = 0; i < 3; i++) {
      mockTurnstile(true);
      mockModerationApprove();
      const res = await postComment(validCommentBody({ pageId, body: `comment number ${i}` }), { ip });
      expect(res.status).toBe(201);
    }

    // 4th request in the window: no Turnstile/moderation mock registered —
    // if the burst limiter didn't stop it first, the unmocked outbound
    // fetch would fail the test.
    const fourth = await postComment(validCommentBody({ pageId, body: "comment number 3" }), { ip });
    expect(fourth.status).toBe(429);
  });

  it("sustained-limits a single IP after RATE_LIMIT_DAILY_MAX approved+attempted submissions", async () => {
    const ip = randomIp();
    const pageId = `page-${crypto.randomUUID()}`;
    const dailyMax = Number(env.RATE_LIMIT_DAILY_MAX);

    // Spread across enough distinct IPs isn't the point here — we want to
    // drive one ip_hash's sustained counter past dailyMax directly rather
    // than firing dailyMax+1 real requests (slow, and would also trip the
    // 3/60s burst limiter long before reaching the sustained one). Seed the
    // counter directly to isolate the sustained tier.
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)",
    )
      .bind(await hashIp(ip, env.IP_HASH_SALT), Date.now(), dailyMax)
      .run();

    const res = await postComment(validCommentBody({ pageId }), { ip });
    // No Turnstile/moderation mock: sustained limit must reject before
    // either is ever consulted.
    expect(res.status).toBe(429);
  });
});

describe("POST /comments — LLM spend circuit breaker", () => {
  it("returns service_paused without calling the LLM once the daily cap is hit", async () => {
    const cap = Number(env.LLM_DAILY_CALL_CAP);
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      "INSERT INTO moderation_budget (date, llm_calls) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET llm_calls = excluded.llm_calls",
    )
      .bind(today, cap)
      .run();

    mockTurnstile(true);
    // No moderation mock registered: an unmocked outbound Anthropic call
    // would fail the test, proving the breaker stopped it beforehand.
    const res = await postComment(validCommentBody());
    expect(res.status).toBe(200);
    const json = await res.json<{ status: string; category: string }>();
    expect(json).toEqual({ status: "rejected", category: "service_paused" });
  });
});
