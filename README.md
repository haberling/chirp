# Chirp

A self-hosted, AI-moderated comment widget for static/flat-file sites. Every comment is screened by an LLM before it's ever stored — no human moderation queue required. Runs serverless on a Cloudflare Worker with a SQLite-family database (D1 by default); site owners deploy their own copy, no shared service.

Ships two ways: a framework-agnostic `<script>` embed for any static site, and a native widget package for sites built on [Canary](https://github.com/haberling/canary).

## Status

Pre-alpha. Planning complete, no code yet — see [PLAN.md](PLAN.md) for the full design (architecture, security model, feature list) and [devJournal.md](devJournal.md) for how the planning process went.

## License

[MIT](LICENSE)
