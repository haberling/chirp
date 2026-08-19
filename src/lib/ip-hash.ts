import { sha256Hex } from "./hash";

// Hashes the connecting IP into an opaque, non-reversible identifier for
// rate limiting / dedupe / abuse-pattern tracking. Raw IPs are never stored
// (see PLAN.md "Security: Rate limiting") — salted so the hash can't be
// brute-forced back to an IP from the small address space alone.
export async function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${ip}`);
}

// `CF-Connecting-IP` is set by Cloudflare's edge on every request and can't
// be spoofed by the client (Cloudflare strips/overwrites any client-sent
// copy) — the only trustworthy non-user-controlled identifier available
// here. Falls back to "unknown" for local dev without the header, which
// still hashes to a stable (if useless) bucket rather than throwing.
export function getConnectingIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") ?? "unknown";
}
