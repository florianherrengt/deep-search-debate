CREATE TABLE `waitlist_entries` (
	`waitlist_entry_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "waitlist_entries_email_normalized_check" CHECK("waitlist_entries"."email" = lower(trim("waitlist_entries"."email")) and length("waitlist_entries"."email") between 1 and 254)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_entries_email_idx` ON `waitlist_entries` (`email`);