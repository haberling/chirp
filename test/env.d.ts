// Ambient augmentation for the `env`/`exports` values imported from
// "cloudflare:workers" in tests — hand-written to match this project's
// existing style of a manual Bindings type (see src/bindings.ts), rather
// than a generated worker-configuration.d.ts that would need to be kept in
// sync with wrangler.test.jsonc.
//
// The indirection through these top-level type aliases matters: extending
// an inline `import("...").X` directly in the `interface Env extends ...`
// clause below silently resolves to an empty type instead of erroring, so
// `env.DB` etc. would report "does not exist" — pre-resolving via a named
// alias first avoids that.
type _Bindings = import("../src/bindings").Bindings;
type _TestMigrations = import("cloudflare:test").D1Migration[];

declare namespace Cloudflare {
  interface Env extends _Bindings {
    // Test-only binding carrying the parsed drizzle/ migrations, injected
    // in vitest.config.ts and consumed by test/setup/migrate.ts.
    TEST_MIGRATIONS: _TestMigrations;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
