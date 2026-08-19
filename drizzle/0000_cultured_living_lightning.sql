CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_id` text,
	`author_name` text NOT NULL,
	`author_email` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`ip_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_page_id_idx` ON `comments` (`page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `moderation_budget` (
	`date` text PRIMARY KEY NOT NULL,
	`llm_calls` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rejected_log` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
