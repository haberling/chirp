export interface CommentInput {
  pageId: string;
  parentId: string | null;
  authorName: string;
  authorEmail: string | null;
  body: string;
  commenterGuid: string;
  turnstileToken: string;
}

type ValidationResult = { ok: true; value: CommentInput } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field validation + honeypot, PLAN.md pipeline step 2 — cheap, no I/O,
// runs before anything that costs money or touches the DB. The honeypot
// check returns the same generic error as a normal validation failure
// (never "you're a bot") so it isn't a distinguishable signal to probe.
export function validateCommentInput(raw: unknown, maxBodyLength: number): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "invalid submission" };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.honeypot === "string" && r.honeypot.trim() !== "") {
    return { ok: false, error: "invalid submission" };
  }

  const pageId = typeof r.pageId === "string" ? r.pageId.trim() : "";
  if (!pageId || pageId.length > 200) {
    return { ok: false, error: "pageId is required" };
  }

  const authorName = typeof r.authorName === "string" ? r.authorName.trim() : "";
  if (!authorName || authorName.length > 100) {
    return { ok: false, error: "authorName is required" };
  }

  let authorEmail: string | null = null;
  if (typeof r.authorEmail === "string" && r.authorEmail.trim() !== "") {
    const email = r.authorEmail.trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return { ok: false, error: "authorEmail is invalid" };
    }
    authorEmail = email;
  }

  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!body || body.length > maxBodyLength) {
    return { ok: false, error: `body is required and must be <= ${maxBodyLength} characters` };
  }

  const commenterGuid = typeof r.commenterGuid === "string" ? r.commenterGuid.trim() : "";
  if (!commenterGuid || commenterGuid.length > 200) {
    return { ok: false, error: "commenterGuid is required" };
  }

  const turnstileToken = typeof r.turnstileToken === "string" ? r.turnstileToken.trim() : "";
  if (!turnstileToken) {
    return { ok: false, error: "turnstileToken is required" };
  }

  const parentId = typeof r.parentId === "string" && r.parentId.trim() !== "" ? r.parentId.trim() : null;

  return {
    ok: true,
    value: { pageId, parentId, authorName, authorEmail, body, commenterGuid, turnstileToken },
  };
}
