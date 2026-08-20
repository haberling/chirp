// Shared behavior for the chirp widget (see chirp.html for the
// template/data contract) -- referenced once per page via <script defer>,
// not duplicated per widget instance, per ../canary/WIDGETS.md.
//
// All the actual logic (fetch/render/submit/Turnstile) lives in the
// shared chirp-core.js -- this file is purely the Canary-specific glue:
// finding instances, running one-time-per-instance async setup, and
// wiring real DOM events the way Canary's widget contract requires.
//
// Delegation on `document` for the interactive parts (form submit, load
// more click, the reveal-form toggle), same as downloads.js/slideshow.js:
// this script runs once,
// on page load, so it can't attach a listener to a specific widget
// instance's node -- hybrid mode's fragment-fetch nav can splice in a
// brand-new data-widget="chirp" instance (a different page) without a
// reload, and nothing calls an init hook for that swap.
//
// enhance(root) + MutationObserver for the one-time-per-instance setup
// delegation can't cover: the initial GET /comments?page= fetch for a
// newly-appeared instance, and Turnstile's render call (its own auto-init
// only scans the DOM once at page load, so a freshly-swapped-in instance's
// .chirp-turnstile div never gets rendered unless this file calls
// turnstile.render() on it itself, inside this same enhance() pass). Same
// pattern as slideshow.js's autoplay-on-first-load, including the
// root.__enhanced guard so re-running enhanceAll doesn't double-init.
//
// DISTRIBUTION NOTE: copy all three of chirp.html, chirp.js, AND the
// parent Chirp project's client/chirp-core.js into your site's widgets/
// folder (chirp-core.js is the one piece not duplicated here -- it's the
// same shared module the generic embed uses, kept as a single source of
// truth in the Chirp repo rather than copy-pasted into two places).

import { initInstance } from "./chirp-core.js";

// EDIT THESE after copying this widget into your own widgets/ folder --
// can't come from the YAML fence block since they're deployment config,
// not per-instance content, following this project's established
// "ejected widget, hardcode local config" pattern. The Turnstile site key
// is meant to be public client-side, unlike the secret -- safe to
// hardcode here.
const API_ORIGIN = "https://your-chirp-worker.example.workers.dev";
const TURNSTILE_SITE_KEY = "REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY";

// root -> its initInstance() controller, so the delegated listeners below
// can find the right instance's actions for whichever one a click/submit
// happened in.
const controllers = new WeakMap();

async function enhance(root) {
  if (root.__enhanced) return;
  root.__enhanced = true;

  const pageId = root.dataset.chirpPage;
  if (!pageId) {
    console.error("[chirp] missing required page: field in the chirp fence block");
    return;
  }

  const controller = await initInstance(root, {
    apiOrigin: API_ORIGIN,
    turnstileSiteKey: TURNSTILE_SITE_KEY,
    pageId,
    onReplyRequested: () => root.querySelector("[data-chirp-toggle]")?.setAttribute("aria-expanded", "true"),
  });
  controllers.set(root, controller);
}

function enhanceAll(root) {
  root.querySelectorAll('[data-widget="chirp"]').forEach(enhance);
}

enhanceAll(document);
new MutationObserver(() => enhanceAll(document)).observe(document.body, { childList: true, subtree: true });

document.addEventListener("click", (e) => {
  const root = e.target.closest('[data-widget="chirp"]');
  if (!root) return;

  if (e.target.closest("[data-chirp-load-more]")) {
    controllers.get(root)?.loadMore();
    return;
  }

  const toggle = e.target.closest("[data-chirp-toggle]");
  if (toggle) {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
  }
});

document.addEventListener("submit", async (e) => {
  const formEl = e.target.closest("[data-chirp-form]");
  if (!formEl) return;
  const root = formEl.closest('[data-widget="chirp"]');
  if (!root) return;
  e.preventDefault();

  const result = await controllers.get(root)?.handleSubmit(formEl);
  if (result?.outcome === "approved") {
    root.querySelector("[data-chirp-toggle]")?.setAttribute("aria-expanded", "false");
  }
});
