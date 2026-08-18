import { Hono } from "hono";

export type Bindings = {
  DB: D1Database;
  RATE_LIMITER: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  SITE_NAME: string;
  ALLOWED_ORIGINS: string;
  MODERATION_MODEL: string;
  MODERATION_POLICY: string;
  COMMENT_MAX_LENGTH: string;
  RATE_LIMIT_DAILY_MAX: string;
  DUPLICATE_WINDOW_S: string;
  LLM_DAILY_CALL_CAP: string;
  TURNSTILE_SITE_KEY: string;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET: string;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

export default app;
