import { setupNetwork } from "@msw/cloudflare";
import { afterAll, afterEach, beforeAll } from "vitest";

// Intercepts the Worker's two outbound calls (Anthropic moderation,
// Turnstile siteverify) so the suite never makes a real network request.
// Individual tests register handlers via `network.use(...)`.
export const network = setupNetwork();

beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
