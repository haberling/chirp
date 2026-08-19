const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Bot resistance, mandatory in v1 (PLAN.md). A network call, so it sits
// after the free/cheap pipeline stages (CORS, validation, dedupe, rate
// limits) and before the paid LLM call. Fails closed on any network/parse
// error — an unreachable Turnstile is treated the same as a failed check,
// not as "let it through."
export async function verifyTurnstile(token: string, secret: string, remoteIp: string): Promise<boolean> {
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
