CREATE TABLE `refine_batches` (
	`refine_batch_id` text PRIMARY KEY NOT NULL,
	`refine_session_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`draft_answers` text DEFAULT '[]' NOT NULL,
	`answers` text,
	`stage_checkpoints` text DEFAULT '{}' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`refine_session_id`) REFERENCES `refine_sessions`(`refine_session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "refine_batches_position_check" CHECK("refine_batches"."position" >= 0),
	CONSTRAINT "refine_batches_status_check" CHECK("refine_batches"."status" in ('preparing', 'ready', 'failed', 'submitted')),
	CONSTRAINT "refine_batches_terminal_fields_check" CHECK((
      ("refine_batches"."status" = 'failed' and "refine_batches"."error" is not null)
      or
      ("refine_batches"."status" != 'failed' and "refine_batches"."error" is null)
    )),
	CONSTRAINT "refine_batches_answer_state_check" CHECK((
      ("refine_batches"."status" = 'submitted' and "refine_batches"."answers" is not null)
      or
      ("refine_batches"."status" != 'submitted' and "refine_batches"."answers" is null)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refine_batches_session_position_idx` ON `refine_batches` (`refine_session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `refine_batches_id_session_id_idx` ON `refine_batches` (`refine_batch_id`,`refine_session_id`);--> statement-breakpoint
CREATE TABLE `refine_search_links` (
	`refine_search_link_id` text PRIMARY KEY NOT NULL,
	`refine_session_id` text NOT NULL,
	`refine_batch_id` text,
	`deep_search_job_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refine_session_id`,`user_id`) REFERENCES `refine_sessions`(`refine_session_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refine_batch_id`,`refine_session_id`) REFERENCES `refine_batches`(`refine_batch_id`,`refine_session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deep_search_job_id`,`user_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "refine_search_links_role_batch_check" CHECK((
      ("refine_search_links"."role" = 'preparation' and "refine_search_links"."refine_batch_id" is not null and "refine_search_links"."position" is not null and "refine_search_links"."position" >= 0)
      or ("refine_search_links"."role" = 'research' and "refine_search_links"."refine_batch_id" is null and "refine_search_links"."position" is null)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refine_search_links_deep_search_job_id_unique` ON `refine_search_links` (`deep_search_job_id`);--> statement-breakpoint
CREATE INDEX `refine_search_links_session_role_idx` ON `refine_search_links` (`refine_session_id`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `refine_search_links_preparation_idx` ON `refine_search_links` (`refine_session_id`,`refine_batch_id`,`position`) WHERE "refine_search_links"."role" = 'preparation';--> statement-breakpoint
CREATE UNIQUE INDEX `refine_search_links_research_idx` ON `refine_search_links` (`refine_session_id`) WHERE "refine_search_links"."role" = 'research';--> statement-breakpoint
CREATE TABLE `refine_sessions` (
	`refine_session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`original_prompt` text NOT NULL,
	`status` text DEFAULT 'clarifying' NOT NULL,
	`active_batch_id` text,
	`final_deep_search_job_id` text,
	`final_research_request` text,
	`shared_state_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_batch_id`,`refine_session_id`) REFERENCES `refine_batches`(`refine_batch_id`,`refine_session_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refine_sessions_prompt_check" CHECK(length(trim("refine_sessions"."original_prompt")) > 0),
	CONSTRAINT "refine_sessions_status_check" CHECK("refine_sessions"."status" in ('clarifying', 'starting', 'research-started')),
	CONSTRAINT "refine_sessions_revision_check" CHECK("refine_sessions"."shared_state_revision" >= 0),
	CONSTRAINT "refine_sessions_research_fields_check" CHECK((
      ("refine_sessions"."status" = 'clarifying' and "refine_sessions"."final_deep_search_job_id" is null and "refine_sessions"."final_research_request" is null)
      or
      ("refine_sessions"."status" in ('starting', 'research-started') and "refine_sessions"."final_deep_search_job_id" is not null and "refine_sessions"."final_research_request" is not null)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refine_sessions_final_deep_search_job_id_unique` ON `refine_sessions` (`final_deep_search_job_id`);--> statement-breakpoint
CREATE INDEX `refine_sessions_user_updated_at_idx` ON `refine_sessions` (`user_id`,`updated_at`,`refine_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refine_sessions_id_user_id_idx` ON `refine_sessions` (`refine_session_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `refine_state_revisions` (
	`refine_state_revision_id` text PRIMARY KEY NOT NULL,
	`refine_session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reason` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`refine_session_id`) REFERENCES `refine_sessions`(`refine_session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "refine_state_revisions_revision_check" CHECK("refine_state_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refine_state_revisions_session_revision_idx` ON `refine_state_revisions` (`refine_session_id`,`revision`);
