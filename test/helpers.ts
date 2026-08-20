import { exports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { network } from "./setup/network";

export const TEST_ORIGIN = "https://example.com";

export function randomIp(): string {
  // Not a real IP, just a unique-per-call string — getConnectingIp() only
  // needs something stable to hash, and using a fresh one per test keeps
  // dedupe/rate-limit state from leaking across tests that share D1/
  // RATE_LIMITER storage (not auto-reset between tests in the same file).
  return crypto.randomUUID();
}

export interface CommentBody {
  pageId?: string;
  parentId?: string | null;
  authorName?: string;
  authorEmail?: string | null;
  body?: string;
  commenterGuid?: string;
  turnstileToken?: string;
  honeypot?: string;
}

export function validCommentBody(overrides: CommentBody = {}): Record<string, unknown> {
  return {
    pageId: "test-page",
    authorName: "Test Commenter",
    body: "A perfectly ordinary comment.",
    commenterGuid: crypto.randomUUID(),
    turnstileToken: "test-turnstile-token",
    ...overrides,
  };
}

export async function postComment(
  body: Record<string, unknown>,
  init: { origin?: string | null; ip?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": init.ip ?? randomIp(),
    ...init.headers,
  };
  if (init.origin !== null) {
    headers.Origin = init.origin ?? TEST_ORIGIN;
  }
  return exports.default.fetch(`${TEST_ORIGIN}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function getComments(query: string, init: { origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.origin) headers.Origin = init.origin;
  return exports.default.fetch(`${TEST_ORIGIN}/comments?${query}`, { headers });
}

// For exercising the "invalid JSON body" 400 path — the other helpers all
// JSON.stringify a well-formed object, which can't produce a parse error.
export async function postRaw(rawBody: string): Promise<Response> {
  return exports.default.fetch(`${TEST_ORIGIN}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN, "CF-Connecting-IP": randomIp() },
    body: rawBody,
  });
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function toolUseResponse(input: Record<string, unknown>) {
  return HttpResponse.json({
    content: [{ type: "tool_use", name: "moderation_verdict", input }],
  });
}

export function mockModerationApprove(): void {
  network.use(
    http.post(ANTHROPIC_URL, () => toolUseResponse({ verdict: "approve", category: "n/a", reason: "n/a" })),
  );
}

export function mockModerationReject(category: string, reason = "test rejection"): void {
  network.use(http.post(ANTHROPIC_URL, () => toolUseResponse({ verdict: "reject", category, reason })));
}

export function mockModerationDown(): void {
  network.use(http.post(ANTHROPIC_URL, () => HttpResponse.text("upstream error", { status: 500 })));
}

export function mockTurnstile(success: boolean): void {
  network.use(http.post(TURNSTILE_URL, () => HttpResponse.json({ success })));
}
