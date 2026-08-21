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
// DISTRIBUTION NOTE: copy only chirp.html, chirp.js, and chirp.css into
// your site's widgets/ folder. chirp-core.js is NOT copied -- it stays
// exactly where the Worker already deployed it (same file the generic
// embed loads) and gets pulled in below via a dynamic import() at
// runtime, not a static one.
//
// Why dynamic, not `import ... from "./chirp-core.js"` at the top of this
// file like the generic embed does: Canary's WIDGETS.md contract emits
// every widget .js file as a plain `<script src="..." defer>` (see
// SiteBuilder.BuildWidgetScriptsHtml), never `type="module"` -- and a
// static `import` statement is a SyntaxError in a classic script, so this
// file wouldn't even parse if it kept one. Dynamic `import()` is a
// function call, not a declaration, so it's legal in any script,
// classic or module -- and pointing it at CORE_MODULE_URL below means
// there's still exactly one copy of chirp-core.js in existence (on the
// Worker), not a second one hand-maintained per adopter site.

// EDIT THESE after copying this widget into your own widgets/ folder --
// can't come from the YAML fence block since they're deployment config,
// not per-instance content, following this project's established
// "ejected widget, hardcode local config" pattern. The Turnstile site key
// is meant to be public client-side, unlike the secret -- safe to
// hardcode here.
//
// enhance() below checks these against the exact literals this file
// shipped with (not a placeholder-shaped-string heuristic) -- a real
// Worker URL or site key could coincidentally look placeholder-ish, but
// it can never *equal* what's still sitting here unedited, so an
// equality check is the one test that can't false-positive on a
// legitimately configured site.
const API_ORIGIN = "https://your-chirp-worker.example.workers.dev";
const TURNSTILE_SITE_KEY = "REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY";
// Cross-origin module fetch (unlike a plain <script src>) is CORS-gated,
// so the Worker sends Access-Control-Allow-Origin on this one file
// specifically -- see client/_headers.
const CORE_MODULE_URL = `${API_ORIGIN}/chirp-core.js`;

// root -> its initInstance() controller, so the delegated listeners below
// can find the right instance's actions for whichever one a click/submit
// happened in.
const controllers = new WeakMap();

// The browser's module map dedupes repeated import()s of the same URL, so
// calling this once per enhance() (rather than hoisting a single
// module-level promise) costs nothing after the first real fetch -- kept
// simple over "clever" for that reason.
async function loadCore() {
  return import(CORE_MODULE_URL);
}

// Site owners are the audience for this message, not developers -- they
// may never open devtools, so a console.error alone (as used for the
// missing-page-id case below) is easy to ship past unnoticed. This
// renders directly into the widget's own DOM instead, in the one place
// every visitor -- including the site owner checking their own work --
// will actually look.
function showConfigWarning(root, unconfigured) {
  const warning = document.createElement("p");
  warning.className = "chirp-config-warning";
  warning.setAttribute("role", "alert");
  warning.textContent =
    `Chirp is not configured: ${unconfigured.join(" and ")} still ` +
    `${unconfigured.length > 1 ? "have" : "has"} the placeholder value ` +
    "from the template. Edit the constants at the top of chirp.js in " +
    "this site's widgets/ folder.";
  root.prepend(warning);
}

async function enhance(root) {
  if (root.__enhanced) return;
  root.__enhanced = true;

  const pageId = root.dataset.chirpPage;
  if (!pageId) {
    console.error("[chirp] missing required page: field in the chirp fence block");
    return;
  }

  const unconfigured = [];
  if (API_ORIGIN === "https://your-chirp-worker.example.workers.dev") unconfigured.push("API_ORIGIN");
  if (TURNSTILE_SITE_KEY === "REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY") unconfigured.push("TURNSTILE_SITE_KEY");
  if (unconfigured.length) {
    // Don't bother attempting the real fetch/Turnstile setup below --
    // API_ORIGIN's placeholder isn't a real endpoint, so that would just
    // be a network error in the console instead of this clear message.
    showConfigWarning(root, unconfigured);
    return;
  }

  const { initInstance } = await loadCore();
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
