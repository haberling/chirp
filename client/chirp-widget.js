// Generic embed entry point. A site owner drops in:
//
//   <script type="module" src="https://your-worker.example.com/chirp-widget.js"
//           data-chirp-page="REQUIRED"
//           data-chirp-turnstile-sitekey="REQUIRED"></script>
//
// This file's only job is format-specific glue: find the script tag,
// build a Shadow-DOM-isolated skeleton (list/status/toggle/form/turnstile
// mount), and wire real DOM events around chirp-core.js's initInstance()
// for everything that isn't specific to "I am a bare script tag with no
// accompanying HTML." Calls initInstance() directly (not a convenience
// enhance() wrapper) because this format needs custom wiring the generic
// wrapper doesn't know about: collapsing the reveal-form back down after
// a successful post.
//
// Note: `document.currentScript` is always null for type="module" scripts
// (unlike classic scripts) — can't use the usual trick to find "my own
// script tag," so this selects on the data-chirp-page attribute instead.
// That means only one Chirp instance per page is supported in the generic
// embed (the Canary widget's multi-instance case is a different problem,
// solved differently — see canary-widget/chirp.js).

import { initInstance } from "./chirp-core.js";

// This widget is Shadow-DOM-isolated specifically so it works on *any*
// host site regardless of that site's own styling — which cuts both ways:
// it also means it can't assume the host page provides a matching
// background. The earlier version only swapped text color in dark mode
// and left the container transparent, so dark-mode text (light-colored,
// meant to sit on a dark surface) ended up rendered directly on whatever
// the host page's own background was — illegible if that happened to be
// white. Fixed by giving .chirp-root an explicit background + border of
// its own in both modes, same self-contained-card treatment the Canary
// widget's chirp.css gives .chirp-widget, so the widget is legible
// regardless of what surrounds it.
//
// The comment form is hidden by default behind a "Post a comment" toggle
// and slides open on click. The slide uses the CSS grid-template-rows
// 0fr->1fr trick rather than an animated max-height guess: it animates to
// the *exact* content height with no magic number, and the toggle's
// aria-expanded attribute both drives the animation (via an adjacent-
// sibling selector) and stays the single source of truth for state —
// no separate JS-managed open/closed class to fall out of sync.
const STYLES = `
  :host { all: initial; }
  .chirp-root {
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    border: 1px solid #e2e2e2;
    border-radius: 8px;
    padding: 16px;
    max-width: 640px;
    box-sizing: border-box;
  }
  .chirp-root * { box-sizing: border-box; }
  .chirp-comment { border-bottom: 1px solid #e2e2e2; padding: 12px 0; }
  .chirp-comment-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .chirp-comment-author { font-weight: 600; }
  .chirp-comment-badge {
    font-size: 11px; padding: 1px 6px; border-radius: 10px;
    background: #e8f0fe; color: #1a56db;
  }
  .chirp-comment-time { font-size: 12px; color: #767676; margin-left: auto; }
  .chirp-comment-body { margin: 0 0 6px; white-space: pre-wrap; word-break: break-word; }
  .chirp-comment-reply { margin-left: 20px; padding-left: 12px; border-left: 2px solid #e2e2e2; }
  .chirp-reply-btn {
    font: inherit; font-size: 12px; padding: 2px 0; border: none; background: none;
    color: #1a56db; cursor: pointer;
  }
  .chirp-reply-btn:hover { text-decoration: underline; }
  .chirp-thread-toggle {
    display: block; font: inherit; font-size: 12px; margin: 4px 0 4px 20px; padding: 2px 0;
    border: none; background: none; color: #767676; cursor: pointer;
  }
  .chirp-thread-toggle:hover { color: #1a56db; }
  .chirp-thread-toggle-icon { display: inline-block; width: 1em; text-align: center; }
  .chirp-replies {
    display: grid; grid-template-rows: 1fr;
    transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .chirp-thread-toggle[aria-expanded="false"] + .chirp-replies { grid-template-rows: 0fr; }
  .chirp-replies-inner { overflow: hidden; min-height: 0; }
  .chirp-empty { color: #767676; }
  .chirp-status { min-height: 1.2em; font-size: 13px; }
  .chirp-status:empty { min-height: 0; }
  .chirp-status-error { margin: 8px 0; padding: 6px 10px; border-radius: 6px; background: #b91c1c; color: #fff; }
  .chirp-status-success { margin: 8px 0; padding: 6px 10px; border-radius: 6px; background: #e8f0fe; color: #1a56db; }
  .chirp-rules-link {
    font: inherit; font-weight: 600; padding: 0; border: none; background: none;
    color: inherit; text-decoration: underline; cursor: pointer;
  }

  .chirp-rules-dialog {
    max-width: 480px; width: 90vw; max-height: 80vh; overflow-y: auto;
    border: none; border-radius: 10px; padding: 20px;
    color: #1a1a1a; background: #ffffff;
  }
  .chirp-rules-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
  .chirp-rules-dialog h2 { margin: 0 0 8px; font-size: 18px; }
  .chirp-rules-dialog h3 { margin: 0 0 2px; font-size: 14px; }
  .chirp-rules-dialog p { margin: 0 0 8px; font-size: 14px; line-height: 1.5; }
  .chirp-rules-item { border-top: 1px solid #e2e2e2; padding-top: 8px; margin-top: 8px; }
  .chirp-rules-footnote { font-size: 12px; color: #767676; margin-top: 16px !important; }
  .chirp-rules-close {
    margin-top: 12px; font: inherit; padding: 6px 16px; border: none; border-radius: 6px;
    background: #1a56db; color: #fff; cursor: pointer;
  }
  .chirp-load-more {
    font: inherit; padding: 6px 12px; border: 1px solid #ccc; border-radius: 6px;
    background: transparent; color: inherit; cursor: pointer;
  }

  .chirp-toggle {
    display: flex; align-items: center; gap: 8px;
    font: inherit; font-weight: 600; padding: 8px 16px; margin-top: 12px;
    border: 1px solid #1a56db; border-radius: 6px;
    background: transparent; color: #1a56db; cursor: pointer;
  }
  .chirp-toggle:hover { background: #1a56db; color: #fff; }
  .chirp-toggle-icon {
    display: inline-flex; align-items: center; justify-content: center;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    font-weight: 400; font-size: 1.9em; line-height: 1; position: relative; top: -3px;
  }
  .chirp-toggle[aria-expanded="true"] .chirp-toggle-icon { transform: rotate(45deg); }

  .chirp-form-wrap {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .chirp-toggle[aria-expanded="true"] + .chirp-form-wrap { grid-template-rows: 1fr; }
  .chirp-form-inner { overflow: hidden; min-height: 0; }

  .chirp-reply-indicator {
    display: flex; align-items: center; gap: 8px; margin-top: 12px;
    padding: 6px 10px; border-radius: 6px; background: #e8f0fe;
    font-size: 13px; color: #1a56db;
  }
  /* [hidden] alone loses to the plain-class rule above (equal specificity,
     later in source order) -- this one's more specific so it actually wins
     and the attribute works as intended. */
  .chirp-reply-indicator[hidden] { display: none; }
  .chirp-reply-indicator button {
    margin-left: auto; font: inherit; font-size: 12px; padding: 0; border: none;
    background: none; color: inherit; text-decoration: underline; cursor: pointer;
  }
  .chirp-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .chirp-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .chirp-form input, .chirp-form textarea {
    font: inherit; padding: 8px; border: 1px solid #ccc; border-radius: 6px;
    background: #ffffff; color: inherit;
  }
  .chirp-form textarea { resize: vertical; min-height: 4em; }
  .chirp-form button[type="submit"] {
    align-self: flex-start; font: inherit; padding: 8px 16px;
    border: none; border-radius: 6px; background: #1a56db; color: #fff; cursor: pointer;
  }
  .chirp-form button[type="submit"]:disabled { opacity: 0.6; cursor: default; }
  .chirp-honeypot { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

  @media (prefers-color-scheme: dark) {
    .chirp-root { color: #e8e8e8; background: #1c1c1c; border-color: #3a3a3a; }
    .chirp-comment { border-color: #333; }
    .chirp-comment-reply { border-left-color: #444; }
    .chirp-comment-badge { background: #1e3a8a; color: #c7d7fe; }
    .chirp-comment-time, .chirp-empty { color: #999; }
    .chirp-reply-btn { color: #7ba7f0; }
    .chirp-thread-toggle { color: #999; }
    .chirp-thread-toggle:hover { color: #7ba7f0; }
    .chirp-reply-indicator { background: #1e3a8a; color: #c7d7fe; }
    .chirp-status-success { background: #1e3a8a; color: #c7d7fe; }
    .chirp-form input, .chirp-form textarea, .chirp-load-more { border-color: #444; background: #262626; color: inherit; }
    .chirp-rules-dialog { color: #e8e8e8; background: #1c1c1c; }
    .chirp-rules-item { border-top-color: #333; }
    .chirp-rules-footnote { color: #999; }
  }
`;

function buildSkeleton() {
  const root = document.createElement("div");
  root.className = "chirp-root";
  root.innerHTML = `
    <div data-chirp-list></div>
    <button type="button" class="chirp-load-more" data-chirp-load-more hidden>Load more</button>
    <div class="chirp-status" role="status" aria-live="polite" data-chirp-status></div>
    <button type="button" class="chirp-toggle" data-chirp-toggle aria-expanded="false">
      <span class="chirp-toggle-icon">+</span> Post a comment
    </button>
    <div class="chirp-form-wrap" data-chirp-form-wrap>
      <div class="chirp-form-inner">
        <div class="chirp-reply-indicator" data-chirp-reply-indicator hidden>
          Replying to <strong data-chirp-reply-name></strong>
          <button type="button" data-chirp-reply-cancel>Cancel</button>
        </div>
        <form class="chirp-form" data-chirp-form novalidate>
          <label>
            Name
            <input type="text" name="authorName" required maxlength="100" autocomplete="name">
          </label>
          <label>
            Email (optional, never shown)
            <input type="email" name="authorEmail" maxlength="254" autocomplete="email">
          </label>
          <label>
            Comment
            <textarea name="body" required maxlength="500"></textarea>
          </label>
          <div class="chirp-honeypot" aria-hidden="true">
            <label>Leave this field blank<input type="text" name="honeypot" tabindex="-1" autocomplete="off"></label>
          </div>
          <div data-chirp-turnstile></div>
          <button type="submit">Post comment</button>
        </form>
      </div>
    </div>
  `;
  return root;
}

async function init(scriptEl) {
  const pageId = scriptEl.dataset.chirpPage;
  const turnstileSiteKey = scriptEl.dataset.chirpTurnstileSitekey;

  if (!pageId) {
    console.error("[chirp] data-chirp-page is required on the Chirp <script> tag");
    return;
  }

  const host = document.createElement("div");
  scriptEl.insertAdjacentElement("afterend", host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);
  shadow.appendChild(buildSkeleton());

  const apiOrigin = new URL(import.meta.url).origin;
  const toggleBtn = shadow.querySelector("[data-chirp-toggle]");
  const controller = await initInstance(shadow, {
    apiOrigin,
    turnstileSiteKey,
    pageId,
    onReplyRequested: () => toggleBtn.setAttribute("aria-expanded", "true"),
  });

  toggleBtn.addEventListener("click", () => {
    const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
  });

  const loadMoreEl = shadow.querySelector("[data-chirp-load-more]");
  if (loadMoreEl) loadMoreEl.addEventListener("click", () => controller.loadMore());

  const formEl = shadow.querySelector("[data-chirp-form]");
  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await controller.handleSubmit(formEl);
    if (result?.outcome === "approved") {
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });
}

const scriptEl = document.querySelector("script[data-chirp-page]");
if (!scriptEl) {
  console.error("[chirp] could not find the Chirp <script> tag (expected a data-chirp-page attribute on it)");
} else {
  init(scriptEl);
}
