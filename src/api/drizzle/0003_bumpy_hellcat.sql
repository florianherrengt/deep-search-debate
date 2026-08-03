CREATE TABLE `idea_jobs` (
	`idea_job_id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`stage` text DEFAULT 'planning' NOT NULL,
	`number_of_ideas` integer NOT NULL,
	`deep_search_count` integer NOT NULL,
	`research_prompt_generation_id` text,
	`research_summary_generation_id` text,
	`idea_generation_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`research_prompt_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`research_summary_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`idea_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "idea_jobs_limits_check" CHECK("idea_jobs"."number_of_ideas" > 0 and "idea_jobs"."deep_search_count" > 0),
	CONSTRAINT "idea_jobs_stage_check" CHECK("idea_jobs"."stage" in ('planning', 'research', 'summary', 'ideas')),
	CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = 'running' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = 'completed' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null and "idea_jobs"."idea_generation_id" is not null)
        or
        ("idea_jobs"."status" in ('failed', 'interrupted') and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_research_prompt_generation_id_unique` ON `idea_jobs` (`research_prompt_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_research_summary_generation_id_unique` ON `idea_jobs` (`research_summary_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_idea_generation_id_unique` ON `idea_jobs` (`idea_generation_id`);--> statement-breakpoint
CREATE INDEX `idea_jobs_created_at_idx` ON `idea_jobs` (`created_at`);--> statement-breakpoint
ALTER TABLE `deep_search_jobs` ADD `idea_job_id` text REFERENCES idea_jobs(idea_job_id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `deep_search_jobs_idea_job_created_at_idx` ON `deep_search_jobs` (`idea_job_id`,`created_at`);
