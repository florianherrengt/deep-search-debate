CREATE TABLE `deep_search_generated_queries` (
	`deep_search_generated_query_id` text PRIMARY KEY NOT NULL,
	`deep_search_query_generation_id` text NOT NULL,
	`position` integer NOT NULL,
	`query` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deep_search_query_generation_id`) REFERENCES `deep_search_query_generations`(`deep_search_query_generation_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deep_search_generated_queries_position_check" CHECK("deep_search_generated_queries"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_generated_queries_generation_position_idx` ON `deep_search_generated_queries` (`deep_search_query_generation_id`,`position`);--> statement-breakpoint
CREATE TABLE `deep_search_jobs` (
	`deep_search_job_id` text PRIMARY KEY NOT NULL,
	`research_request` text NOT NULL,
	`max_searches` integer NOT NULL,
	`max_results_per_search` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	CONSTRAINT "deep_search_jobs_limits_check" CHECK("deep_search_jobs"."max_searches" > 0 and "deep_search_jobs"."max_results_per_search" > 0),
	CONSTRAINT "deep_search_jobs_status_check" CHECK("deep_search_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "deep_search_jobs_terminal_fields_check" CHECK((
        ("deep_search_jobs"."status" = 'running' and "deep_search_jobs"."completed_at" is null and "deep_search_jobs"."error" is null)
        or
        ("deep_search_jobs"."status" = 'completed' and "deep_search_jobs"."completed_at" is not null and "deep_search_jobs"."error" is null)
        or
        ("deep_search_jobs"."status" in ('failed', 'interrupted') and "deep_search_jobs"."completed_at" is not null and "deep_search_jobs"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE INDEX `deep_search_jobs_created_at_idx` ON `deep_search_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `deep_search_queries` (
	`deep_search_query_id` text PRIMARY KEY NOT NULL,
	`deep_search_generated_query_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`selection_generation_id` text,
	`summary_generation_id` text,
	`error_stage` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`deep_search_generated_query_id`) REFERENCES `deep_search_generated_queries`(`deep_search_generated_query_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`summary_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deep_search_queries_status_check" CHECK("deep_search_queries"."status" in ('pending', 'searching', 'selecting', 'summarizing', 'completed', 'failed')),
	CONSTRAINT "deep_search_queries_error_stage_check" CHECK("deep_search_queries"."error_stage" is null or "deep_search_queries"."error_stage" in ('search', 'selection', 'summary')),
	CONSTRAINT "deep_search_queries_error_fields_check" CHECK((
        ("deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null)
        or
        ("deep_search_queries"."error_stage" is not null and "deep_search_queries"."error_message" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_queries_deep_search_generated_query_id_unique` ON `deep_search_queries` (`deep_search_generated_query_id`);--> statement-breakpoint
CREATE TABLE `deep_search_query_generations` (
	`deep_search_query_generation_id` text PRIMARY KEY NOT NULL,
	`deep_search_job_id` text NOT NULL,
	`llm_generation_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deep_search_job_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_query_generations_deep_search_job_id_unique` ON `deep_search_query_generations` (`deep_search_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_query_generations_llm_generation_id_unique` ON `deep_search_query_generations` (`llm_generation_id`);--> statement-breakpoint
CREATE TABLE `deep_search_results` (
	`deep_search_result_id` text PRIMARY KEY NOT NULL,
	`deep_search_query_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`short_text` text NOT NULL,
	`url` text NOT NULL,
	`selection_status` text DEFAULT 'pending' NOT NULL,
	`deep_search_web_page_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deep_search_query_id`) REFERENCES `deep_search_queries`(`deep_search_query_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deep_search_web_page_id`) REFERENCES `deep_search_web_pages`(`deep_search_web_page_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deep_search_results_position_check" CHECK("deep_search_results"."position" >= 0),
	CONSTRAINT "deep_search_results_selection_status_check" CHECK("deep_search_results"."selection_status" in ('pending', 'selected', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_results_query_position_idx` ON `deep_search_results` (`deep_search_query_id`,`position`);--> statement-breakpoint
CREATE TABLE `deep_search_web_pages` (
	`deep_search_web_page_id` text PRIMARY KEY NOT NULL,
	`deep_search_job_id` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary_generation_id` text,
	`error_stage` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`deep_search_job_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`summary_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deep_search_web_pages_status_check" CHECK("deep_search_web_pages"."status" in ('pending', 'extracting', 'summarizing', 'completed', 'failed')),
	CONSTRAINT "deep_search_web_pages_error_stage_check" CHECK("deep_search_web_pages"."error_stage" is null or "deep_search_web_pages"."error_stage" in ('extraction', 'summary')),
	CONSTRAINT "deep_search_web_pages_error_fields_check" CHECK((
        ("deep_search_web_pages"."error_stage" is null and "deep_search_web_pages"."error_message" is null)
        or
        ("deep_search_web_pages"."error_stage" is not null and "deep_search_web_pages"."error_message" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_web_pages_job_url_idx` ON `deep_search_web_pages` (`deep_search_job_id`,`url`);--> statement-breakpoint
CREATE TABLE `llm_generations` (
	`llm_generation_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`text` text,
	`reasoning` text,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	CONSTRAINT "llm_generations_status_check" CHECK("llm_generations"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "llm_generations_output_fields_check" CHECK((
        ("llm_generations"."text" is null and "llm_generations"."reasoning" is null)
        or
        ("llm_generations"."text" is not null and "llm_generations"."reasoning" is not null)
      )),
	CONSTRAINT "llm_generations_terminal_fields_check" CHECK((
        ("llm_generations"."status" = 'running' and "llm_generations"."text" is null and "llm_generations"."reasoning" is null and "llm_generations"."completed_at" is null and "llm_generations"."error" is null)
        or
        ("llm_generations"."status" = 'completed' and "llm_generations"."text" is not null and "llm_generations"."reasoning" is not null and "llm_generations"."completed_at" is not null and "llm_generations"."error" is null)
        or
        ("llm_generations"."status" in ('failed', 'interrupted') and "llm_generations"."completed_at" is not null and "llm_generations"."error" is not null)
      ))
);
--> statement-breakpoint
DROP TABLE `searches`;
