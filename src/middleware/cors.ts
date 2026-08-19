import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

function parseAllowedOrigins(env: Bindings): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isAllowedOrigin(c: Context<{ Bindings: Bindings }>, origin: string): boolean {
  return parseAllowedOrigins(c.env).includes(origin);
}

// Exact-origin allowlist (PLAN.md "Security: CORS"): comma-separated,
// fail closed if ALLOWED_ORIGINS is unset, no wildcards, no credentials
// mode. Reflects the exact matched origin back rather than "*".
//
// Only sets response headers when Origin is present and allowed — it does
// not reject the request itself. That's a deliberate GET/POST split: POST
// enforces this as a hard 403 in its own pipeline (forged submissions are
// the risk there), but GET /comments is public read data with no mutation
// risk, so a missing/mismatched Origin (curl, server-side fetch, uptime
// checks) still gets a 200 — only a disallowed *browser* cross-origin read
// gets blocked, by the browser itself, from the absent CORS header.
export const publicCors: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && isAllowedOrigin(c, origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  await next();
};

// Strict variant for POST /comments: missing or disallowed Origin is a
// hard 403, first check in the pipeline, before any other cost is spent
// (PLAN.md: "Origin mismatch or missing Origin on a POST -> 403"). Unlike
// publicCors, this actually rejects the request rather than just omitting
// headers — POST mutates state, so a forged cross-origin/non-browser
// submission needs to be stopped server-side, not just hidden from a
// browser's JS.
export const requireAllowedOrigin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const origin = c.req.header("Origin");
  if (!origin || !isAllowedOrigin(c, origin)) {
    return c.json({ error: "origin not allowed" }, 403);
  }
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  await next();
};

// CORS preflight (OPTIONS) for the JSON POST — browsers send this ahead of
// any cross-origin POST with a Content-Type: application/json body.
export function handlePreflight(c: Context<{ Bindings: Bindings }>): Response {
  const origin = c.req.header("Origin");
  if (!origin || !isAllowedOrigin(c, origin)) {
    return c.body(null, 403);
  }
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Max-Age", "86400");
  return c.body(null, 204);
}
