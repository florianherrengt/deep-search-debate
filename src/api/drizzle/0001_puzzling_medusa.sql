ALTER TABLE `deep_search_jobs` ADD `title` text DEFAULT 'Untitled' NOT NULL;--> statement-breakpoint
ALTER TABLE `deep_search_jobs` ADD `slug` text DEFAULT 'untitled' NOT NULL;--> statement-breakpoint
CREATE INDEX `deep_search_jobs_user_slug_idx` ON `deep_search_jobs` (`user_id`,`slug`);--> statement-breakpoint
ALTER TABLE `idea_jobs` ADD `title` text DEFAULT 'Untitled' NOT NULL;--> statement-breakpoint
ALTER TABLE `idea_jobs` ADD `slug` text DEFAULT 'untitled' NOT NULL;--> statement-breakpoint
CREATE INDEX `idea_jobs_user_slug_idx` ON `idea_jobs` (`user_id`,`slug`);