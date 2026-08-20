import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-file storage isolation and may run more than
// once; applyD1Migrations() only applies migrations not already applied,
// so re-running this is safe. `TEST_MIGRATIONS` is read from the drizzle/
// directory at config-build time (see vitest.config.ts) — worker code
// itself has no filesystem access to read migration files directly.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
