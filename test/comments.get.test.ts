import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getComments, mockModerationApprove, mockTurnstile, postComment, validCommentBody } from "./helpers";

afterEach(async () => {
  await env.DB.prepare("DELETE FROM comments").run();
});

describe("GET /comments", () => {
  it("400s when the required page query param is missing", async () => {
    const res = await getComments("");
    expect(res.status).toBe(400);
  });

  it("returns only comments for the requested page, oldest first", async () => {
    const pageId = `page-${crypto.randomUUID()}`;
    const otherPageId = `page-${crypto.randomUUID()}`;

    for (const [page, text] of [
      [pageId, "first"],
      [otherPageId, "wrong page"],
      [pageId, "second"],
    ] as const) {
      mockTurnstile(true);
      mockModerationApprove();
      const res = await postComment(validCommentBody({ pageId: page, body: text }));
      expect(res.status).toBe(201);
    }

    const res = await getComments(`page=${pageId}`);
    expect(res.status).toBe(200);
    const json = await res.json<{ comments: { body: string }[]; nextCursor: number | null }>();
    expect(json.comments.map((c) => c.body)).toEqual(["first", "second"]);
    expect(json.nextCursor).toBeNull();
  });

  it("never returns an authorEmail field", async () => {
    mockTurnstile(true);
    mockModerationApprove();
    const pageId = `page-${crypto.randomUUID()}`;
    await postComment(validCommentBody({ pageId, authorEmail: "commenter@example.com" }));

    const res = await getComments(`page=${pageId}`);
    const text = await res.text();
    expect(text).not.toContain("commenter@example.com");
    expect(text).not.toContain("authorEmail");
  });

  it("paginates with limit + nextCursor, and cursor excludes already-seen rows", async () => {
    const pageId = `page-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      mockTurnstile(true);
      mockModerationApprove();
      const res = await postComment(validCommentBody({ pageId, body: `comment ${i}` }));
      expect(res.status).toBe(201);
    }

    const firstPage = await getComments(`page=${pageId}&limit=2`);
    const firstJson = await firstPage.json<{ comments: { body: string }[]; nextCursor: number | null }>();
    expect(firstJson.comments).toHaveLength(2);
    expect(firstJson.nextCursor).not.toBeNull();

    const secondPage = await getComments(`page=${pageId}&limit=2&cursor=${firstJson.nextCursor}`);
    const secondJson = await secondPage.json<{ comments: { body: string }[]; nextCursor: number | null }>();
    expect(secondJson.comments).toHaveLength(1);
    expect(secondJson.nextCursor).toBeNull();

    const seenBodies = [...firstJson.comments, ...secondJson.comments].map((c) => c.body);
    expect(new Set(seenBodies).size).toBe(3);
  });

  it("400s on a non-numeric cursor", async () => {
    const res = await getComments("page=whatever&cursor=not-a-number");
    expect(res.status).toBe(400);
  });

  it("is readable cross-origin from any Origin (public read, no allowlist enforcement)", async () => {
    const res = await getComments("page=whatever", { origin: "https://not-in-the-allowlist.example" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
