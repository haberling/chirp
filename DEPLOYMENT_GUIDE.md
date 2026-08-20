# Deployment Guide

Chirp is self-hosted: you deploy your own copy to your own Cloudflare
account against your own D1 database. There's no shared service and no
account to sign up for beyond Cloudflare and Anthropic. This is the
end-to-end walkthrough — for what Chirp is and how it's designed, see
[README.md](README.md) and [PLAN.md](PLAN.md).

## Prerequisites

- A Cloudflare account (any plan — D1, Workers, and Turnstile all have
  usable free tiers)
- [Node.js](https://nodejs.org/) 20+ and npm
- An [Anthropic API key](https://console.anthropic.com/) — used for the
  moderation call, billed to your own account (see PLAN.md's "Rough cost
  shape" for what to expect: roughly $1 per 1,000 comments moderated)
- The site(s) you're embedding Chirp on — you'll need their exact
  origin(s) for CORS and Turnstile

## 1. Clone and install

```bash
git clone <this-repo-url> chirp
cd chirp
npm install
npx wrangler login   # authenticates the CLI against your Cloudflare account
```

## 2. Create the D1 database

```bash
npx wrangler d1 create chirp
```

This prints a `database_id` — keep it, you'll need it in step 5.

## 3. Set up Turnstile

Turnstile is mandatory (see PLAN.md's "Bot resistance") — the Worker
refuses to publish a comment without a valid token.

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Domain(s): the site(s) you're embedding Chirp on — not the Worker's own
   `workers.dev` domain.
3. Widget mode: **Managed** is the reasonable default.
4. You'll get two values: a **Site Key** (public, ships in the widget's
   HTML/JS) and a **Secret Key** (private, goes on the Worker only). Keep
   both for steps 5 and 6.

## 4. Get an Anthropic API key

[console.anthropic.com](https://console.anthropic.com/) → API Keys →
Create Key. This is the `ANTHROPIC_API_KEY` secret in step 6.

## 5. Configure wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

`wrangler.toml` is gitignored on purpose — it holds values specific to
your deployment. Edit it:

- `database_id` under `[[d1_databases]]` — from step 2
- `SITE_NAME` — anything, used only in your own logs/dashboard
- `ALLOWED_ORIGINS` — exact, comma-separated origins of the site(s)
  embedding Chirp (e.g. `https://example.com,https://www.example.com`).
  No wildcards, no trailing slashes — see PLAN.md's "Security: CORS" for
  why this is a hard allowlist rather than reflecting any origin.
- `TURNSTILE_SITE_KEY` — the Site Key from step 3
- `MODERATION_POLICY` — the shipped default is a reasonable starting
  point (see the comment above it in the file); read it over and adjust
  to your site's actual tone before going live, since this text directly
  decides what gets published
- `COMMENT_MAX_LENGTH`, `RATE_LIMIT_DAILY_MAX`, `DUPLICATE_WINDOW_S`,
  `LLM_DAILY_CALL_CAP` — the shipped defaults are sane starting points;
  revisit them once you have real traffic

## 6. Generate and set secrets

Secrets never go in `wrangler.toml` — they're set individually and stored
encrypted on Cloudflare's side.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# paste the key from step 4

npx wrangler secret put TURNSTILE_SECRET
# paste the Secret Key from step 3

npx wrangler secret put IP_HASH_SALT
# any random string — generate one with: openssl rand -hex 32

npx wrangler secret put COMMENTER_ID_SALT
# a *different* random string, same method — keep it independent from
# IP_HASH_SALT so either can be rotated without affecting the other

npx wrangler secret put HEALTH_CHECK_TOKEN
# any random string — this is the bearer token your uptime monitor will
# send to GET /health (see step 8)
```

## 7. Apply migrations

```bash
npm run db:migrate:remote
```

Runs the Drizzle-generated migrations in `drizzle/` against your real D1
database (the same command `db:migrate:local` runs against local dev
storage — see **Local development** below).

## 8. Deploy

```bash
npm run deploy
```

This ships the Worker (API + moderation pipeline) and the generic embed's
static files (`client/chirp-widget.js`, `client/chirp-core.js`) together —
`[assets]` in `wrangler.toml` serves them straight off the same Worker, no
separate hosting step. Wrangler prints your Worker's URL (a `workers.dev`
subdomain by default, or your own domain if you've set one up in the
Cloudflare dashboard) — that's your Chirp API origin, needed in step 9.

Sanity-check it:

```bash
curl -H "Authorization: Bearer <your HEALTH_CHECK_TOKEN>" \
  https://<your-worker>.workers.dev/health
```

A healthy response looks like
`{"status":"ok","db":"ok","config":"ok","llmCircuitBreaker":"ok"}`. Point
your uptime monitor at this URL with that same header — see PLAN.md's
"Observability" for what it checks and doesn't (no live calls to
Anthropic/Turnstile, so it won't catch every failure mode, just
connectivity and config presence).

## 9. Embed the widget

Pick whichever matches your site:

### Generic `<script>` embed (any static site)

```html
<script type="module"
        src="https://<your-worker>.workers.dev/chirp-widget.js"
        data-chirp-page="REQUIRED-unique-page-id"
        data-chirp-turnstile-sitekey="<your Turnstile Site Key>"></script>
```

- `data-chirp-page` must be a stable identifier for the page the comments
  belong to — not derived from the URL, so renaming/redirecting the page
  later doesn't orphan its comment thread (see PLAN.md's "Page identity").
  Pick something you control, e.g. a slug from your CMS.
- The widget auto-detects its API origin from its own `src` — no separate
  config needed.
- It's Shadow-DOM isolated (self-contained light/dark styling), so it
  won't collide with your site's own CSS.

### Canary widget package (sites already running [Canary](../canary))

1. Copy `canary-widget/chirp.html`, `canary-widget/chirp.js`, and
   `canary-widget/chirp.css` into your Canary site's `widgets/` folder.
   **Don't** copy `client/chirp-core.js` — it stays put and gets loaded
   from your deployed Worker at runtime (`chirp.js` does this itself via
   a dynamic `import()`, since Canary's widget scripts are plain classic
   `<script defer>` tags, not ES modules, so a static `import` can't be
   used there the way the generic embed uses one). This keeps
   `chirp-core.js` a true single source of truth shared between both
   delivery formats — see PLAN.md's "Client architecture" — nothing to
   keep in sync across a copy.
2. Edit the two constants at the top of your copied `chirp.js`:
   ```js
   const API_ORIGIN = "https://<your-worker>.workers.dev";
   const TURNSTILE_SITE_KEY = "<your Turnstile Site Key>";
   ```
3. Drop the widget into a page with a fence block:
   ````
   ```chirp
   page: my-page-id
   ```
   ````
   `page` is required with no fallback, same reasoning as the generic
   embed's `data-chirp-page`.

## Operating your deployment

No admin HTTP endpoints exist by design (see PLAN.md's "Decisions locked
in: Admin/operator access") — operator actions go through `wrangler d1
execute --remote`, authenticated by your own Cloudflare account rather
than a bearer secret this app would have to invent, protect, and rotate.

**Review recent moderation rejections** (last 100, site-wide — a rolling
log to catch false positives/negatives and tune `MODERATION_POLICY`):

```bash
npx wrangler d1 execute chirp --remote \
  --command "SELECT page_id, author_name, body, category, reason, created_at FROM rejected_log ORDER BY created_at DESC LIMIT 20"
```

**Delete an already-published comment** (the safety valve against a
moderation false negative — find the `id` via a `SELECT` first):

```bash
npx wrangler d1 execute chirp --remote \
  --command "DELETE FROM comments WHERE id = '<comment-id>'"
```

**Change `MODERATION_POLICY` or any other var/limit**: edit
`wrangler.toml`, then `npm run deploy` again — no migration needed, vars
take effect on the next deploy.

**Rotate a secret**: re-run `wrangler secret put <NAME>` with a new value;
takes effect immediately, no redeploy needed. Rotating `IP_HASH_SALT` or
`COMMENTER_ID_SALT` invalidates all existing dedupe/rate-limit/"same
commenter" continuity for currently-tracked IPs and commenter GUIDs going
forward (not destructive — just a clean break in that continuity).

## Backups and data recovery

D1 has built-in point-in-time recovery ("Time Travel" — 7 days on the
Free plan, roughly 30 days on Paid) with no setup required. No custom
backup tooling exists in this project because none is needed:

```bash
npx wrangler d1 time-travel restore chirp --timestamp=<unix-timestamp>
# or restore to a specific bookmark instead of a timestamp:
npx wrangler d1 time-travel restore chirp --bookmark=<bookmark-value>
```

See [Cloudflare's D1 Time Travel docs](https://developers.cloudflare.com/d1/reference/time-travel/)
for the current command reference.

## Privacy and data ownership

Chirp stores a commenter's display name always, and their email only if
they choose to give one (never rendered publicly — see PLAN.md's
"Decisions locked in: Identity"). As the operator of your own deployment,
**you are the data controller** for whatever your site's commenters submit
— writing (or linking to) a privacy policy that covers this is your
responsibility, not something this project dictates or ships a template
for.

## Local development

For iterating on the widget or the Worker itself before deploying:

```bash
cp .dev.vars.example .dev.vars   # fill in local-only secret values
npm run db:migrate:local
npm run db:seed:preview          # optional: known fake comments for visual testing
npm run dev                      # terminal 1: wrangler dev, on :8787
npm run dev:preview              # terminal 2: serves dev/preview.html, on :8788
npm test                         # integration suite — runs entirely locally,
                                  # no deployed resources or real API keys needed
```

Then open `http://localhost:8788/preview.html`. It's two separate
processes on purpose: `dev/preview.html` lives outside `client/` (the
directory `wrangler dev`/`deploy` actually serves), so a stray dev-only
page never has a chance to ship alongside the real widget files the way
it once accidentally did — see `client/_headers`' comment for the related
CORS note. `wrangler.toml`'s `ALLOWED_ORIGINS` already includes
`http://localhost:8788` for this reason; remove it before a real deploy.

See `test/` for how the integration suite mocks the two outbound calls
(Anthropic, Turnstile) while exercising the real D1/rate-limit bindings
locally.
