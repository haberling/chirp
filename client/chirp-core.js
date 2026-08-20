// Shared client logic for Chirp, consumed by both delivery formats (the
// generic <script> embed and the Canary widget). Neither format hand-rolls
// its own fetch/render/submit/turnstile logic — everything here operates
// on a `root` node (a Shadow DOM root or a plain element, doesn't matter
// which) that's expected to already contain the following, found by
// data-attribute rather than tag/class so either format can lay out the
// markup however it wants:
//
//   [data-chirp-list]        comment list container
//   [data-chirp-status]      aria-live region for status/error messages
//   [data-chirp-load-more]   "load more" button (hidden when no more pages)
//   [data-chirp-form]        the submit <form>
//     input[name=authorName]
//     input[name=authorEmail]
//     textarea[name=body]
//     input[name=honeypot]   must stay empty; real users never see/fill it
//     button[type=submit]
//   [data-chirp-turnstile]   Turnstile mount div

// Per-category canned messages shown to the submitter (never the raw LLM
// `reason` — see PLAN.md "Security: Rejection feedback"). Plain object,
// not a build artifact — an adopter who wants different wording just
// edits this file after copying it into their own site, same "eject and
// customize" pattern the Canary widget already uses for its own config.
export const REJECTION_MESSAGES = {
  spam: "This looks like spam.",
  harassment: "This comment appears to target another person directly.",
  obscenity: "This comment contains explicit content that isn't allowed here.",
  threats: "This comment appears to threaten someone.",
  blasphemy: "This comment isn't allowed here.",
  doxxing: "This comment shares someone's private information, which isn't allowed.",
  self_harm:
    "It sounds like you might be going through something hard. If you're in crisis, please reach out — " +
    "988 Suicide & Crisis Lifeline (call or text 988 in the US), or https://findahelpline.com for other " +
    "countries. Your comment wasn't published.",
  service_paused: "Comments are temporarily paused — please try again later.",
  moderation_unavailable: "We're having trouble reaching our comment moderation service right now — please try again in a few minutes.",
};

// The categories that mean "your content tripped a real rule" — as
// opposed to service_paused/moderation_unavailable, which mean "the
// moderation system itself had a problem" and have nothing to do with
// what was written. Only the former gets a "Rules" link on the error
// message; a capacity/outage message pointing someone at a rules page
// would be actively misleading.
const POLICY_CATEGORIES = new Set([
  "spam",
  "harassment",
  "obscenity",
  "threats",
  "blasphemy",
  "doxxing",
  "self_harm",
]);

// Human-facing translation of the server's MODERATION_POLICY (see
// wrangler.toml) — written for a reader, not an LLM, so the tone and
// framing differ even though the substance must stay the same. Plain
// data, same "edit after copying" convention as REJECTION_MESSAGES —
// whoever changes MODERATION_POLICY should update this to match, since
// nothing keeps the two in sync automatically.
export const RULES_CONTENT = {
  title: "Comment Section Rules",
  intro:
    "This comment section is meant to stay open. Strong opinions, dark humor, coarse language, and heated " +
    "(but honest) disagreement are all fine — being edgy or unpopular isn't a reason for a comment to get " +
    "removed. Every comment is reviewed automatically, not by a person, and only gets rejected for one of " +
    "the reasons below. If the AI has flagged your comment unjustly, you have my apologies.",
  sections: [
    { heading: "Spam", body: "Promotional, repetitive, or bot-like content that has nothing to do with the discussion." },
    {
      heading: "Harassment",
      body: "Targeting a specific person with demeaning or abusive language. Harsh criticism of an argument or idea is fine — focus on attacking ideas as opposed to people.",
    },
    { heading: "Obscenity", body: "Graphic sexual content. Swearing for emphasis is fine." },
    {
      heading: "Threats",
      body: 'Threatening someone with harm — physical violence, doxxing ("I\'ll post your address"), or coercion ("I\'ll get you fired"). A hostile or even hateful opinion is fine as long as it isn\'t an actual threat.',
    },
    {
      heading: "Blasphemy",
      body: "Contemptuous mockery of core Christian beliefs (the Trinity, Christ's divinity) or figures. Jesus Christ really did die and rise again for the salvation of the whole world, and we are not interested in hosting content that mocks, denigrates, or contradicts that fact. Genuine questions and good faith criticism of Christians' behavior or politics are fine.",
    },
    { heading: "Doxxing", body: "Posting someone's real private information (home address, phone number, workplace)." },
    {
      heading: "Self-harm content",
      body: "A genuine, current expression of wanting to hurt yourself. Venting about a bad day, dark jokes, and hyperbole (\"this show makes me want to die\") are fine — intent is what matters, not the specific words used. If you're struggling, please reach out: 988 Suicide & Crisis Lifeline, call or text 988 (US).",
    },
  ],
};

const DEFAULT_ERROR_MESSAGE = "Something went wrong submitting your comment. Please try again.";

const PROFILE_STORAGE_KEY = "chirp_commenter_profile";

// The raw GUID is the client-held secret (see src/lib/commenter-id.ts) —
// generated once per browser, sent with every submission, never displayed
// or logged. `commenterId` is the salted hash the server returns after a
// successful submit; cached here so "is this comment mine" checks on
// later reads don't require resubmitting.
function getOrCreateProfile() {
  let raw = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.guid === "string") return parsed;
    } catch {
      // fall through to regenerate a fresh profile
    }
  }
  const profile = { guid: crypto.randomUUID(), commenterId: null };
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export async function fetchComments(apiOrigin, pageId, { cursor, limit } = {}) {
  const url = new URL("/comments", apiOrigin);
  url.searchParams.set("page", pageId);
  if (cursor != null) url.searchParams.set("cursor", String(cursor));
  if (limit != null) url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`fetchComments failed: ${res.status}`);
  }
  return res.json();
}

export async function submitComment(apiOrigin, { pageId, parentId, authorName, authorEmail, body, honeypot, turnstileToken }) {
  const profile = getOrCreateProfile();

  const res = await fetch(new URL("/comments", apiOrigin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId,
      parentId: parentId ?? null,
      authorName,
      authorEmail: authorEmail || null,
      body,
      honeypot,
      commenterGuid: profile.guid,
      turnstileToken,
    }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    return { outcome: "error", message: DEFAULT_ERROR_MESSAGE };
  }

  if (res.status === 201 && data.status === "approved") {
    // Cache the server-computed commenterId so later reads can badge
    // "this is you" without another round trip.
    profile.commenterId = data.comment.commenterId;
    saveProfile(profile);
    return { outcome: "approved", comment: data.comment };
  }

  if (res.status === 200 && data.status === "rejected") {
    const message = REJECTION_MESSAGES[data.category] ?? DEFAULT_ERROR_MESSAGE;
    return { outcome: "rejected", category: data.category, message };
  }

  if (res.status === 409) {
    return { outcome: "error", message: "You've already posted that — give it a moment before posting again." };
  }
  if (res.status === 429) {
    return { outcome: "error", message: "You're posting a bit too fast — please slow down and try again shortly." };
  }
  if (res.status === 403) {
    return { outcome: "error", message: "We couldn't verify you're not a bot. Please try again." };
  }

  return { outcome: "error", message: data.error || DEFAULT_ERROR_MESSAGE };
}

export function myCommenterId() {
  return getOrCreateProfile().commenterId;
}

// Renders `comments` into `listEl` using textContent only, never
// innerHTML — comments are plain-text-only in v1 (no markdown/HTML), so
// there's no legitimate case where a `<` in a comment body should become
// live markup. See PLAN.md "Security: XSS (comment rendering)" — this
// function is the entire control point for that guarantee, for both
// delivery formats, since both call it.
// Reply buttons only render on top-level comments — nesting stays exactly
// one level deep by construction, not just visually flattened. A reply
// whose own parent is itself a reply (possible via direct API use, though
// the UI never creates this) still gets grouped/indented under its
// top-level ancestor, walking the chain up rather than assuming exactly
// one hop — the "collapse to one visual level" half of the decision.
// Clicking Reply doesn't open a per-comment form (see PLAN.md Phase 2 —
// "a 'replying to X' indicator on the form", singular): it targets the
// one shared form via a delegated click listener on `listEl` set up in
// initInstance(), identified by data-comment-id/data-author-name so it
// survives re-renders with no per-button listener bookkeeping.
export function renderComments(listEl, comments, collapsedThreadIds = new Set()) {
  listEl.replaceChildren();

  if (comments.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chirp-empty";
    empty.textContent = "No comments yet — be the first.";
    listEl.appendChild(empty);
    return;
  }

  const mine = myCommenterId();
  const counts = new Map();
  for (const c of comments) counts.set(c.commenterId, (counts.get(c.commenterId) || 0) + 1);

  const byId = new Map(comments.map((c) => [c.id, c]));
  function topLevelIdOf(comment) {
    let current = comment;
    const seen = new Set();
    while (current.parentId != null && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
    return current.id;
  }

  const topLevel = [];
  const repliesByTopLevel = new Map();
  for (const c of comments) {
    if (c.parentId == null) {
      topLevel.push(c);
    } else {
      const topId = topLevelIdOf(c);
      if (!repliesByTopLevel.has(topId)) repliesByTopLevel.set(topId, []);
      repliesByTopLevel.get(topId).push(c);
    }
  }

  function renderOne(c, isReply, container) {
    const item = document.createElement("article");
    item.className = isReply ? "chirp-comment chirp-comment-reply" : "chirp-comment";

    const header = document.createElement("div");
    header.className = "chirp-comment-header";

    const name = document.createElement("span");
    name.className = "chirp-comment-author";
    name.textContent = c.authorName;
    header.appendChild(name);

    if (c.commenterId && (c.commenterId === mine || counts.get(c.commenterId) > 1)) {
      const badge = document.createElement("span");
      badge.className = "chirp-comment-badge";
      badge.textContent = c.commenterId === mine ? "you" : "same commenter";
      header.appendChild(badge);
    }

    const time = document.createElement("time");
    time.className = "chirp-comment-time";
    time.dateTime = new Date(c.createdAt).toISOString();
    time.textContent = new Date(c.createdAt).toLocaleString();
    header.appendChild(time);

    const body = document.createElement("p");
    body.className = "chirp-comment-body";
    body.textContent = c.body;

    item.appendChild(header);
    item.appendChild(body);

    if (!isReply) {
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "chirp-reply-btn";
      replyBtn.textContent = "Reply";
      replyBtn.dataset.chirpReply = "";
      replyBtn.dataset.commentId = c.id;
      replyBtn.dataset.authorName = c.authorName;
      item.appendChild(replyBtn);
    }

    container.appendChild(item);
  }

  // Reply threads default open, but a caller-owned collapsedThreadIds Set
  // (see initInstance()) lets collapse state survive a re-render — kept
  // in memory only, in the closure, never localStorage: it's meant to
  // last for this page view, not follow the visitor around. The
  // grid-template-rows 0fr/1fr trick used for the reveal-form toggle gets
  // reused here for the same reason: animates to exact content height,
  // aria-expanded on the toggle is the single source of truth driving
  // both the animation (via CSS) and the icon/state (via the delegated
  // click handler in initInstance(), which also keeps the Set updated).
  for (const c of topLevel) {
    renderOne(c, false, listEl);
    const replies = repliesByTopLevel.get(c.id);
    if (replies && replies.length > 0) {
      const isCollapsed = collapsedThreadIds.has(c.id);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "chirp-thread-toggle";
      toggle.dataset.chirpThreadToggle = "";
      toggle.dataset.commentId = c.id;
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      const icon = document.createElement("span");
      icon.className = "chirp-thread-toggle-icon";
      icon.textContent = isCollapsed ? "+" : "−";
      toggle.appendChild(icon);
      toggle.append(` ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`);
      listEl.appendChild(toggle);

      const repliesWrap = document.createElement("div");
      repliesWrap.className = "chirp-replies";
      const repliesInner = document.createElement("div");
      repliesInner.className = "chirp-replies-inner";
      repliesWrap.appendChild(repliesInner);
      for (const reply of replies) {
        renderOne(reply, true, repliesInner);
      }
      listEl.appendChild(repliesWrap);
    }
  }
}

// Builds (once per root, reused after) and opens a native <dialog> showing
// RULES_CONTENT. <dialog>.showModal() gets focus-trapping, Escape-to-close,
// and a ::backdrop dimmer for free — no hand-rolled overlay/focus-trap
// code needed. Appended into `root` itself (not document.body) so it picks
// up the caller's own styling, whether that's a Shadow DOM's scoped
// stylesheet (generic embed) or a normal cascade (Canary widget) — same
// "operate on whatever root is, don't assume which kind" rule as
// everything else in this file.
export function showRulesModal(root) {
  let dialog = root.querySelector("[data-chirp-rules-dialog]");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "chirp-rules-dialog";
    dialog.dataset.chirpRulesDialog = "";
    // Focusable without joining the tab order — see the showModal() call
    // below for why this matters.
    dialog.tabIndex = -1;

    const heading = document.createElement("h2");
    heading.textContent = RULES_CONTENT.title;
    dialog.appendChild(heading);

    const intro = document.createElement("p");
    intro.textContent = RULES_CONTENT.intro;
    dialog.appendChild(intro);

    for (const section of RULES_CONTENT.sections) {
      const item = document.createElement("div");
      item.className = "chirp-rules-item";
      const h = document.createElement("h3");
      h.textContent = section.heading;
      const p = document.createElement("p");
      p.textContent = section.body;
      item.appendChild(h);
      item.appendChild(p);
      dialog.appendChild(item);
    }

    if (RULES_CONTENT.footnote) {
      const footnote = document.createElement("p");
      footnote.className = "chirp-rules-footnote";
      footnote.textContent = RULES_CONTENT.footnote;
      dialog.appendChild(footnote);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "chirp-rules-close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => dialog.close());
    dialog.appendChild(closeBtn);

    root.appendChild(dialog);
  }
  dialog.showModal();
  // Without an [autofocus] element, showModal() focuses the only
  // focusable descendant (the Close button, at the very bottom) and
  // scrolls it into view — which drags the whole scrollable dialog down,
  // hiding the title. Focusing the dialog itself instead keeps it at the
  // top on open, same as most native modal implementations behave.
  dialog.focus();
  dialog.scrollTop = 0;
}

// Loads the Turnstile script at most once per page, even if multiple
// widget instances call this — later calls just wait on the first load.
let turnstileLoadPromise = null;
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoadPromise) {
    turnstileLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Turnstile"));
      document.head.appendChild(script);
    });
  }
  return turnstileLoadPromise;
}

// Renders a Turnstile widget into `mountEl` and returns a getToken()
// function. Turnstile tokens are single-use, so getToken() resets the
// widget (fetching a fresh token) every time it's called rather than
// returning a cached, possibly-already-spent one.
export async function initTurnstile(mountEl, siteKey) {
  await loadTurnstileScript();
  const widgetId = window.turnstile.render(mountEl, { sitekey: siteKey });
  return {
    getToken: () =>
      new Promise((resolve) => {
        const check = () => {
          const token = window.turnstile.getResponse(widgetId);
          if (token) resolve(token);
          else setTimeout(check, 100);
        };
        check();
      }),
    reset: () => window.turnstile.reset(widgetId),
  };
}

// Sets up one widget instance rooted at `root` (a Shadow DOM root or a
// plain element — doesn't care which): initial fetch+render, and Turnstile
// init. This is the "one-time-per-instance async setup" half — the half
// that genuinely can't be delegated, same as slideshow.js's
// wait-for-first-image-then-autoplay pattern. Returns a controller with
// the actions (`loadMore`, `handleSubmit`) so the *caller* decides how to
// wire them to real events: direct listeners are fine for the generic
// embed (exactly one instance, no router ever re-inserts it), but the
// Canary widget needs document-level delegation (see canary-widget/chirp.js
// and WIDGETS.md) since hybrid-mode nav can splice in a fresh instance
// without a reload. Splitting setup from event-wiring is what lets both
// formats share 100% of this logic instead of each hand-rolling it.
export async function initInstance(root, { apiOrigin, turnstileSiteKey, pageId, onReplyRequested }) {
  const listEl = root.querySelector("[data-chirp-list]");
  const statusEl = root.querySelector("[data-chirp-status]");
  const loadMoreEl = root.querySelector("[data-chirp-load-more]");
  const turnstileEl = root.querySelector("[data-chirp-turnstile]");
  const replyIndicatorEl = root.querySelector("[data-chirp-reply-indicator]");
  const replyNameEl = root.querySelector("[data-chirp-reply-name]");
  const replyCancelEl = root.querySelector("[data-chirp-reply-cancel]");

  // "error" and "success" get visually distinct treatment (see chirp-core
  // consumers' CSS: a solid red box for errors, an accent-tinted box for
  // success) — kind is null to clear the message back to empty/no-box.
  // showRules appends a "Rules" link that opens the RULES_CONTENT modal —
  // only meaningful on genuine content-policy rejections (see
  // POLICY_CATEGORIES), never on capacity/outage-style errors.
  function setStatus(kind, message, { showRules = false } = {}) {
    if (!statusEl) return;
    statusEl.classList.remove("chirp-status-success", "chirp-status-error");
    if (kind) statusEl.classList.add(`chirp-status-${kind}`);

    statusEl.replaceChildren();
    if (!message) return;

    statusEl.append(message);
    if (showRules) {
      statusEl.append(" ");
      const link = document.createElement("button");
      link.type = "button";
      link.className = "chirp-rules-link";
      link.textContent = "Rules";
      link.addEventListener("click", () => showRulesModal(root));
      statusEl.appendChild(link);
    }
  }

  let nextCursor = null;

  // Which comment (if any) a reply targets — set by clicking a per-comment
  // Reply button, cleared on cancel or successful submit. There's exactly
  // one shared form (see renderComments' header comment for why), so this
  // is the only state needed regardless of how many comments are loaded.
  let replyTarget = null;

  function setReplyTarget(target) {
    replyTarget = target;
    if (replyIndicatorEl) replyIndicatorEl.hidden = !target;
    if (replyNameEl) replyNameEl.textContent = target ? target.authorName : "";
  }

  // Delegated on `listEl` itself, not attached per-button/per-toggle —
  // renderComments re-creates every comment node on each reload()/
  // loadMore(), so per-element listeners would need re-wiring on every
  // render. One listener on the stable container handles every past and
  // future Reply button and thread-collapse toggle.
  listEl.addEventListener("click", (e) => {
    const replyBtn = e.target.closest("[data-chirp-reply]");
    if (replyBtn) {
      setReplyTarget({ id: replyBtn.dataset.commentId, authorName: replyBtn.dataset.authorName });
      onReplyRequested?.();
      return;
    }

    const threadToggle = e.target.closest("[data-chirp-thread-toggle]");
    if (threadToggle) {
      const wasExpanded = threadToggle.getAttribute("aria-expanded") === "true";
      threadToggle.setAttribute("aria-expanded", String(!wasExpanded));
      const icon = threadToggle.querySelector(".chirp-thread-toggle-icon");
      if (icon) icon.textContent = wasExpanded ? "+" : "−";
      if (wasExpanded) {
        collapsedThreadIds.add(threadToggle.dataset.commentId);
      } else {
        collapsedThreadIds.delete(threadToggle.dataset.commentId);
      }
    }
  });

  if (replyCancelEl) {
    replyCancelEl.addEventListener("click", () => setReplyTarget(null));
  }

  // Kept as one accumulated array rather than incremental DOM appends —
  // renderComments' "same commenter" badging needs the full loaded set to
  // compute counts against, and at real comment-thread scale (dozens to
  // low hundreds) a full re-render on each page load is not a real cost.
  let allComments = [];

  // Which top-level comment threads are collapsed, by id — in-memory only
  // (this closure, this page view), never persisted to localStorage.
  // Survives reload()/loadMore()'s full re-render since renderComments()
  // reads it fresh each time rather than each toggle owning its own state.
  const collapsedThreadIds = new Set();

  async function reload() {
    try {
      const data = await fetchComments(apiOrigin, pageId);
      allComments = data.comments;
      renderComments(listEl, allComments, collapsedThreadIds);
      nextCursor = data.nextCursor;
      if (loadMoreEl) loadMoreEl.hidden = nextCursor == null;
    } catch {
      setStatus("error", "Couldn't load comments right now.");
    }
  }

  async function loadMore() {
    if (nextCursor == null) return;
    try {
      const data = await fetchComments(apiOrigin, pageId, { cursor: nextCursor });
      allComments = allComments.concat(data.comments);
      renderComments(listEl, allComments, collapsedThreadIds);
      nextCursor = data.nextCursor;
      if (loadMoreEl) loadMoreEl.hidden = nextCursor == null;
    } catch {
      setStatus("error", "Couldn't load more comments right now.");
    }
  }

  let turnstile = null;
  if (turnstileEl && turnstileSiteKey) {
    turnstile = await initTurnstile(turnstileEl, turnstileSiteKey);
  }

  async function handleSubmit(formEl) {
    const submitBtn = formEl.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    setStatus(null);

    try {
      const token = turnstile ? await turnstile.getToken() : "";
      const result = await submitComment(apiOrigin, {
        pageId,
        parentId: replyTarget?.id ?? null,
        authorName: formEl.authorName?.value ?? "",
        authorEmail: formEl.authorEmail?.value ?? "",
        body: formEl.body?.value ?? "",
        honeypot: formEl.honeypot?.value ?? "",
        turnstileToken: token,
      });

      if (result.outcome === "approved") {
        setStatus("success", "Comment posted.");
        formEl.reset();
        setReplyTarget(null);
        await reload();
      } else {
        const showRules = result.outcome === "rejected" && POLICY_CATEGORIES.has(result.category);
        setStatus("error", result.message, { showRules });
      }
      return result;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (turnstile) turnstile.reset();
    }
  }

  await reload();

  return { reload, loadMore, handleSubmit };
}
