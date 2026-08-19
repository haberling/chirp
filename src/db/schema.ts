import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    parentId: text("parent_id"),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    ipHash: text("ip_hash").notNull(),
    // Salted hash of a client-held GUID (see src/lib/commenter-id.ts) — a
    // good-faith "same commenter" continuity tag, not a security identity.
    commenterId: text("commenter_id").notNull(),
  },
  (table) => ({
    pageIdIdx: index("comments_page_id_idx").on(table.pageId, table.createdAt),
  }),
);

// Ring buffer: trimmed to the last 100 rows (site-wide) on insert, not
// enforced by the schema — the insert path is responsible for the trim.
export const rejectedLog = sqliteTable("rejected_log", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Sustained/daily rate-limit tier only — the burst tier lives entirely in
// the native `ratelimit` binding, no table needed for it.
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), // ip_hash
  windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
  count: integer("count").notNull(),
});

// One row per UTC day, self-resetting (date-keyed) — the LLM spend
// circuit breaker's counter.
export const moderationBudget = sqliteTable("moderation_budget", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  llmCalls: integer("llm_calls").notNull(),
});
