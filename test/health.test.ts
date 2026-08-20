import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function getHealth(token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return exports.default.fetch("https://example.com/health", { headers });
}

describe("GET /health", () => {
  it("401s with no Authorization header", async () => {
    const res = await getHealth();
    expect(res.status).toBe(401);
  });

  it("401s with the wrong token", async () => {
    const res = await getHealth("not-the-right-token");
    expect(res.status).toBe(401);
  });

  it("200s with db/config ok and reports the circuit breaker state given the right token", async () => {
    const res = await getHealth(env.HEALTH_CHECK_TOKEN);
    expect(res.status).toBe(200);
    const json = await res.json<{ status: string; db: string; config: string; llmCircuitBreaker: string }>();
    expect(json).toMatchObject({ status: "ok", db: "ok", config: "ok" });
    expect(["ok", "tripped"]).toContain(json.llmCircuitBreaker);
  });
});
