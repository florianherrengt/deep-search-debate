CREATE TABLE `deep_search_jobs` (
	`deep_search_job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idea_job_id` text,
	`idea_job_position` integer,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`slug` text DEFAULT 'untitled' NOT NULL,
	`research_request` text NOT NULL,
	`max_searches` integer NOT NULL,
	`max_results_per_search` integer NOT NULL,
	`max_rounds` integer DEFAULT 3 NOT NULL,
	`final_answer_generation_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`idea_job_id`,`user_id`) REFERENCES `idea_jobs`(`idea_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`final_answer_generation_id`,`user_id`,`deep_search_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`user_id`,`deep_search_job_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_jobs_idea_job_position_check" CHECK((
        ("deep_search_jobs"."idea_job_id" is null and "deep_search_jobs"."idea_job_position" is null)
        or
        ("deep_search_jobs"."idea_job_id" is not null and "deep_search_jobs"."idea_job_position" >= 0)
      )),
	CONSTRAINT "deep_search_jobs_limits_check" CHECK("deep_search_jobs"."max_searches" > 0 and "deep_search_jobs"."max_results_per_search" > 0 and "deep_search_jobs"."max_rounds" > 0),
	CONSTRAINT "deep_search_jobs_research_request_content_check" CHECK(length(trim("deep_search_jobs"."research_request")) > 0),
	CONSTRAINT "deep_search_jobs_status_check" CHECK("deep_search_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "deep_search_jobs_terminal_fields_check" CHECK((
        ("deep_search_jobs"."status" = 'running' and "deep_search_jobs"."completed_at" is null and "deep_search_jobs"."error" is null)
        or
        ("deep_search_jobs"."status" = 'completed' and "deep_search_jobs"."final_answer_generation_id" is not null and "deep_search_jobs"."completed_at" is not null and "deep_search_jobs"."error" is null)
        or
        ("deep_search_jobs"."status" in ('failed', 'interrupted') and "deep_search_jobs"."completed_at" is not null and "deep_search_jobs"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_jobs_final_answer_generation_id_unique` ON `deep_search_jobs` (`final_answer_generation_id`);--> statement-breakpoint
CREATE INDEX `deep_search_jobs_user_created_at_idx` ON `deep_search_jobs` (`user_id`,`created_at`,`deep_search_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_jobs_slug_idx` ON `deep_search_jobs` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_jobs_id_user_id_idx` ON `deep_search_jobs` (`deep_search_job_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_jobs_idea_job_position_idx` ON `deep_search_jobs` (`idea_job_id`,`idea_job_position`);--> statement-breakpoint
CREATE TABLE `deep_search_queries` (
	`deep_search_query_id` text PRIMARY KEY NOT NULL,
	`deep_search_round_id` text NOT NULL,
	`position` integer NOT NULL,
	`query` text NOT NULL,
	`credits_used` integer,
	`status` text DEFAULT 'searching' NOT NULL,
	`selection_generation_id` text,
	`summary_generation_id` text,
	`error_stage` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`deep_search_round_id`) REFERENCES `deep_search_rounds`(`deep_search_round_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`summary_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_queries_status_check" CHECK("deep_search_queries"."status" in ('searching', 'selecting', 'summarizing', 'completed', 'failed')),
	CONSTRAINT "deep_search_queries_position_check" CHECK("deep_search_queries"."position" >= 0),
	CONSTRAINT "deep_search_queries_content_check" CHECK(length(trim("deep_search_queries"."query")) > 0),
	CONSTRAINT "deep_search_queries_error_stage_check" CHECK("deep_search_queries"."error_stage" is null or "deep_search_queries"."error_stage" in ('search', 'selection', 'summary')),
	CONSTRAINT "deep_search_queries_error_fields_check" CHECK((
        ("deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null)
        or
        ("deep_search_queries"."error_stage" is not null and "deep_search_queries"."error_message" is not null)
      )),
	CONSTRAINT "deep_search_queries_lifecycle_check" CHECK((
        ("deep_search_queries"."status" = 'searching' and "deep_search_queries"."selection_generation_id" is null and "deep_search_queries"."summary_generation_id" is null and "deep_search_queries"."completed_at" is null and "deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null)
        or
        ("deep_search_queries"."status" = 'selecting' and "deep_search_queries"."summary_generation_id" is null and "deep_search_queries"."completed_at" is null and "deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null)
        or
        ("deep_search_queries"."status" = 'summarizing' and "deep_search_queries"."selection_generation_id" is not null and "deep_search_queries"."completed_at" is null and "deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null)
        or
        ("deep_search_queries"."status" = 'completed' and "deep_search_queries"."completed_at" is not null and "deep_search_queries"."error_stage" is null and "deep_search_queries"."error_message" is null and (
          ("deep_search_queries"."selection_generation_id" is not null and "deep_search_queries"."summary_generation_id" is not null)
          or
          ("deep_search_queries"."selection_generation_id" is null and "deep_search_queries"."summary_generation_id" is null)
        ))
        or
        ("deep_search_queries"."status" = 'failed' and "deep_search_queries"."completed_at" is not null and "deep_search_queries"."error_stage" is not null and "deep_search_queries"."error_message" is not null and (
          ("deep_search_queries"."error_stage" = 'search' and "deep_search_queries"."selection_generation_id" is null and "deep_search_queries"."summary_generation_id" is null)
          or
          ("deep_search_queries"."error_stage" = 'selection' and "deep_search_queries"."summary_generation_id" is null)
          or
          ("deep_search_queries"."error_stage" = 'summary' and "deep_search_queries"."selection_generation_id" is not null)
        ))
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_queries_round_position_idx` ON `deep_search_queries` (`deep_search_round_id`,`position`);--> statement-breakpoint
CREATE INDEX `deep_search_queries_selection_generation_id_idx` ON `deep_search_queries` (`selection_generation_id`);--> statement-breakpoint
CREATE INDEX `deep_search_queries_summary_generation_id_idx` ON `deep_search_queries` (`summary_generation_id`);--> statement-breakpoint
CREATE TABLE `deep_search_rounds` (
	`deep_search_round_id` text PRIMARY KEY NOT NULL,
	`deep_search_job_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`llm_generation_id` text NOT NULL,
	`answer_generation_id` text,
	`review_generation_id` text,
	`review_decision` text,
	`review_reason` text,
	`review_error` text,
	`review_completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`deep_search_job_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answer_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_rounds_position_check" CHECK("deep_search_rounds"."position" >= 0),
	CONSTRAINT "deep_search_rounds_review_decision_check" CHECK("deep_search_rounds"."review_decision" is null or "deep_search_rounds"."review_decision" in ('continue', 'stop')),
	CONSTRAINT "deep_search_rounds_review_lifecycle_check" CHECK((
        ("deep_search_rounds"."review_generation_id" is null and "deep_search_rounds"."review_decision" is null and "deep_search_rounds"."review_reason" is null and "deep_search_rounds"."review_error" is null and "deep_search_rounds"."review_completed_at" is null)
        or
        ("deep_search_rounds"."review_generation_id" is not null and "deep_search_rounds"."review_decision" is null and "deep_search_rounds"."review_reason" is null and "deep_search_rounds"."review_error" is null and "deep_search_rounds"."review_completed_at" is null)
        or
        ("deep_search_rounds"."review_generation_id" is not null and "deep_search_rounds"."review_decision" is not null and "deep_search_rounds"."review_reason" is not null and "deep_search_rounds"."review_error" is null and "deep_search_rounds"."review_completed_at" is not null)
        or
        ("deep_search_rounds"."review_decision" is null and "deep_search_rounds"."review_reason" is null and "deep_search_rounds"."review_error" is not null and "deep_search_rounds"."review_completed_at" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_rounds_llm_generation_id_unique` ON `deep_search_rounds` (`llm_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_rounds_answer_generation_id_unique` ON `deep_search_rounds` (`answer_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_rounds_review_generation_id_unique` ON `deep_search_rounds` (`review_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_rounds_job_position_idx` ON `deep_search_rounds` (`deep_search_job_id`,`position`);--> statement-breakpoint
CREATE TABLE `deep_search_results` (
	`deep_search_result_id` text PRIMARY KEY NOT NULL,
	`deep_search_query_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`short_text` text NOT NULL,
	`url` text NOT NULL,
	`selected_web_page_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`deep_search_query_id`) REFERENCES `deep_search_queries`(`deep_search_query_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_web_page_id`) REFERENCES `deep_search_web_pages`(`deep_search_web_page_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_results_position_check" CHECK("deep_search_results"."position" >= 0),
	CONSTRAINT "deep_search_results_content_check" CHECK(length(trim("deep_search_results"."title")) > 0 and length(trim("deep_search_results"."short_text")) > 0 and length(trim("deep_search_results"."url")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_results_query_position_idx` ON `deep_search_results` (`deep_search_query_id`,`position`);--> statement-breakpoint
CREATE INDEX `deep_search_results_selected_web_page_id_idx` ON `deep_search_results` (`selected_web_page_id`);--> statement-breakpoint
CREATE TABLE `deep_search_web_pages` (
	`deep_search_web_page_id` text PRIMARY KEY NOT NULL,
	`deep_search_job_id` text NOT NULL,
	`url` text NOT NULL,
	`credits_used` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary_generation_id` text,
	`error_stage` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`deep_search_job_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`summary_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_web_pages_status_check" CHECK("deep_search_web_pages"."status" in ('pending', 'extracting', 'summarizing', 'completed', 'failed')),
	CONSTRAINT "deep_search_web_pages_url_content_check" CHECK(length(trim("deep_search_web_pages"."url")) > 0),
	CONSTRAINT "deep_search_web_pages_error_stage_check" CHECK("deep_search_web_pages"."error_stage" is null or "deep_search_web_pages"."error_stage" in ('extraction', 'summary')),
	CONSTRAINT "deep_search_web_pages_error_fields_check" CHECK((
        ("deep_search_web_pages"."error_stage" is null and "deep_search_web_pages"."error_message" is null)
        or
        ("deep_search_web_pages"."error_stage" is not null and "deep_search_web_pages"."error_message" is not null)
      )),
	CONSTRAINT "deep_search_web_pages_lifecycle_check" CHECK((
        ("deep_search_web_pages"."status" in ('pending', 'extracting') and "deep_search_web_pages"."summary_generation_id" is null and "deep_search_web_pages"."completed_at" is null and "deep_search_web_pages"."error_stage" is null and "deep_search_web_pages"."error_message" is null)
        or
        ("deep_search_web_pages"."status" = 'summarizing' and "deep_search_web_pages"."summary_generation_id" is not null and "deep_search_web_pages"."completed_at" is null and "deep_search_web_pages"."error_stage" is null and "deep_search_web_pages"."error_message" is null)
        or
        ("deep_search_web_pages"."status" = 'completed' and "deep_search_web_pages"."summary_generation_id" is not null and "deep_search_web_pages"."completed_at" is not null and "deep_search_web_pages"."error_stage" is null and "deep_search_web_pages"."error_message" is null)
        or
        ("deep_search_web_pages"."status" = 'failed' and "deep_search_web_pages"."completed_at" is not null and "deep_search_web_pages"."error_stage" is not null and "deep_search_web_pages"."error_message" is not null and ("deep_search_web_pages"."error_stage" = 'summary' or "deep_search_web_pages"."summary_generation_id" is null))
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_web_pages_job_url_idx` ON `deep_search_web_pages` (`deep_search_job_id`,`url`);--> statement-breakpoint
CREATE INDEX `deep_search_web_pages_summary_generation_id_idx` ON `deep_search_web_pages` (`summary_generation_id`);--> statement-breakpoint
CREATE TABLE `debate_jobs` (
	`debate_job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`random_seed` integer NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`stage` text DEFAULT 'ideas' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debate_jobs_config_check" CHECK("debate_jobs"."random_seed" >= 0 and "debate_jobs"."random_seed" <= 4294967295),
	CONSTRAINT "debate_jobs_visibility_check" CHECK("debate_jobs"."is_public" in (0, 1)),
	CONSTRAINT "debate_jobs_stage_check" CHECK("debate_jobs"."stage" in ('ideas', 'swiss', 'semifinal', 'final')),
	CONSTRAINT "debate_jobs_status_check" CHECK("debate_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "debate_jobs_terminal_fields_check" CHECK((
        ("debate_jobs"."status" = 'running' and "debate_jobs"."completed_at" is null and "debate_jobs"."error" is null)
        or
        ("debate_jobs"."status" = 'completed' and "debate_jobs"."stage" = 'final' and "debate_jobs"."completed_at" is not null and "debate_jobs"."error" is null)
        or
        ("debate_jobs"."status" in ('failed', 'interrupted') and "debate_jobs"."completed_at" is not null and "debate_jobs"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE INDEX `debate_jobs_user_created_at_idx` ON `debate_jobs` (`user_id`,`created_at`,`debate_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `debate_jobs_id_user_id_idx` ON `debate_jobs` (`debate_job_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `debate_matches` (
	`debate_match_id` text PRIMARY KEY NOT NULL,
	`debate_round_id` text NOT NULL,
	`position` integer NOT NULL,
	`first_idea_id` text NOT NULL,
	`second_idea_id` text NOT NULL,
	`winner_idea_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`debate_round_id`) REFERENCES `debate_rounds`(`debate_round_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_idea_id`) REFERENCES `ideas`(`idea_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second_idea_id`) REFERENCES `ideas`(`idea_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_idea_id`) REFERENCES `ideas`(`idea_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "debate_matches_ideas_check" CHECK("debate_matches"."position" >= 0 and "debate_matches"."first_idea_id" != "debate_matches"."second_idea_id"),
	CONSTRAINT "debate_matches_winner_check" CHECK("debate_matches"."winner_idea_id" is null or "debate_matches"."winner_idea_id" in ("debate_matches"."first_idea_id", "debate_matches"."second_idea_id")),
	CONSTRAINT "debate_matches_completion_check" CHECK((
        ("debate_matches"."winner_idea_id" is null and "debate_matches"."completed_at" is null)
        or
        ("debate_matches"."winner_idea_id" is not null and "debate_matches"."completed_at" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debate_matches_round_position_idx` ON `debate_matches` (`debate_round_id`,`position`);--> statement-breakpoint
CREATE INDEX `debate_matches_first_idea_id_idx` ON `debate_matches` (`first_idea_id`);--> statement-breakpoint
CREATE INDEX `debate_matches_second_idea_id_idx` ON `debate_matches` (`second_idea_id`);--> statement-breakpoint
CREATE INDEX `debate_matches_winner_idea_id_idx` ON `debate_matches` (`winner_idea_id`);--> statement-breakpoint
CREATE TABLE `debate_messages` (
	`debate_message_id` text PRIMARY KEY NOT NULL,
	`debate_match_id` text NOT NULL,
	`position` integer NOT NULL,
	`speaker_slot` integer NOT NULL,
	`llm_generation_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`debate_match_id`) REFERENCES `debate_matches`(`debate_match_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "debate_messages_speaker_check" CHECK("debate_messages"."position" >= 0 and "debate_messages"."speaker_slot" in (0, 1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debate_messages_llm_generation_id_unique` ON `debate_messages` (`llm_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `debate_messages_match_position_idx` ON `debate_messages` (`debate_match_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `debate_messages_match_judge_idx` ON `debate_messages` (`debate_match_id`) WHERE "debate_messages"."speaker_slot" = 2;--> statement-breakpoint
CREATE TABLE `debate_rounds` (
	`debate_round_id` text PRIMARY KEY NOT NULL,
	`debate_job_id` text NOT NULL,
	`stage` text NOT NULL,
	`stage_round_number` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`debate_job_id`) REFERENCES `debate_jobs`(`debate_job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debate_rounds_number_check" CHECK("debate_rounds"."stage_round_number" > 0),
	CONSTRAINT "debate_rounds_stage_check" CHECK("debate_rounds"."stage" in ('swiss', 'semifinal', 'final') and ("debate_rounds"."stage" = 'swiss' or "debate_rounds"."stage_round_number" = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debate_rounds_job_stage_number_idx` ON `debate_rounds` (`debate_job_id`,`stage`,`stage_round_number`);--> statement-breakpoint
CREATE TABLE `idea_jobs` (
	`idea_job_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`debate_job_id` text,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`slug` text DEFAULT 'untitled' NOT NULL,
	`prompt` text NOT NULL,
	`stage` text DEFAULT 'planning' NOT NULL,
	`number_of_ideas` integer NOT NULL,
	`deep_search_count` integer NOT NULL,
	`research_prompt_generation_id` text,
	`research_summary_generation_id` text,
	`idea_generation_id` text,
	`selection_generation_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debate_job_id`,`user_id`) REFERENCES `debate_jobs`(`debate_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_prompt_generation_id`,`user_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`user_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`research_summary_generation_id`,`user_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`user_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`idea_generation_id`,`user_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`user_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selection_generation_id`,`user_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`user_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "idea_jobs_limits_check" CHECK("idea_jobs"."number_of_ideas" > 0 and "idea_jobs"."deep_search_count" > 0),
	CONSTRAINT "idea_jobs_stage_check" CHECK("idea_jobs"."stage" in ('planning', 'research', 'summary', 'ideas')),
	CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "idea_jobs_prompt_content_check" CHECK(length(trim("idea_jobs"."prompt")) > 0),
	CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = 'running' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = 'completed' and "idea_jobs"."stage" = 'ideas' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null and "idea_jobs"."idea_generation_id" is not null)
        or
        ("idea_jobs"."status" in ('failed', 'interrupted') and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_debate_job_id_unique` ON `idea_jobs` (`debate_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_research_prompt_generation_id_unique` ON `idea_jobs` (`research_prompt_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_research_summary_generation_id_unique` ON `idea_jobs` (`research_summary_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_idea_generation_id_unique` ON `idea_jobs` (`idea_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_selection_generation_id_unique` ON `idea_jobs` (`selection_generation_id`);--> statement-breakpoint
CREATE INDEX `idea_jobs_user_created_at_idx` ON `idea_jobs` (`user_id`,`created_at`,`idea_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_slug_idx` ON `idea_jobs` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_id_user_id_idx` ON `idea_jobs` (`idea_job_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`idea_id` text PRIMARY KEY NOT NULL,
	`idea_job_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`critique_generation_id` text,
	`selected` integer,
	`refinement_generation_id` text,
	`refined_title` text,
	`refined_description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`idea_job_id`) REFERENCES `idea_jobs`(`idea_job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`critique_generation_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refinement_generation_id`,`idea_job_id`) REFERENCES `llm_generations`(`llm_generation_id`,`idea_job_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ideas_position_check" CHECK("ideas"."position" >= 0),
	CONSTRAINT "ideas_content_check" CHECK(length(trim("ideas"."title")) > 0 and length(trim("ideas"."description")) > 0),
	CONSTRAINT "ideas_refinement_lifecycle_check" CHECK((
        ("ideas"."refinement_generation_id" is null and "ideas"."refined_title" is null and "ideas"."refined_description" is null)
        or
        ("ideas"."selected" = 1 and "ideas"."refinement_generation_id" is not null and (
          ("ideas"."refined_title" is null and "ideas"."refined_description" is null)
          or
          ("ideas"."refined_title" is not null and length(trim("ideas"."refined_title")) > 0 and "ideas"."refined_description" is not null and length(trim("ideas"."refined_description")) > 0)
        ))
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_critique_generation_id_unique` ON `ideas` (`critique_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_refinement_generation_id_unique` ON `ideas` (`refinement_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_job_position_idx` ON `ideas` (`idea_job_id`,`position`);--> statement-breakpoint
CREATE TABLE `llm_generations` (
	`llm_generation_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`debate_job_id` text,
	`idea_job_id` text,
	`deep_search_job_id` text,
	`model_id` text,
	`prompt_name` text,
	`status` text DEFAULT 'running' NOT NULL,
	`text` text,
	`reasoning` text,
	`error` text,
	`finish_reason` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`credits_used` integer,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debate_job_id`,`user_id`) REFERENCES `debate_jobs`(`debate_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`idea_job_id`,`user_id`) REFERENCES `idea_jobs`(`idea_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deep_search_job_id`,`user_id`) REFERENCES `deep_search_jobs`(`deep_search_job_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "llm_generations_at_most_one_job_owner_check" CHECK((
        ("llm_generations"."debate_job_id" is not null)
        + ("llm_generations"."idea_job_id" is not null)
        + ("llm_generations"."deep_search_job_id" is not null)
      ) <= 1),
	CONSTRAINT "llm_generations_status_check" CHECK("llm_generations"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "llm_generations_output_fields_check" CHECK((
        ("llm_generations"."text" is null and "llm_generations"."reasoning" is null)
        or
        ("llm_generations"."text" is not null and "llm_generations"."reasoning" is not null)
      )),
	CONSTRAINT "llm_generations_terminal_fields_check" CHECK((
        ("llm_generations"."status" = 'running' and "llm_generations"."text" is null and "llm_generations"."reasoning" is null and "llm_generations"."completed_at" is null and "llm_generations"."error" is null)
        or
        ("llm_generations"."status" = 'completed' and "llm_generations"."text" is not null and length(trim("llm_generations"."text", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0 and "llm_generations"."reasoning" is not null and "llm_generations"."completed_at" is not null and "llm_generations"."error" is null)
        or
        ("llm_generations"."status" in ('failed', 'interrupted') and "llm_generations"."completed_at" is not null and "llm_generations"."error" is not null)
      ))
);
--> statement-breakpoint
CREATE INDEX `llm_generations_user_started_at_idx` ON `llm_generations` (`user_id`,`started_at`,`llm_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_generations_id_user_idea_job_idx` ON `llm_generations` (`llm_generation_id`,`user_id`,`idea_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_generations_id_idea_job_idx` ON `llm_generations` (`llm_generation_id`,`idea_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_generations_id_user_deep_search_job_idx` ON `llm_generations` (`llm_generation_id`,`user_id`,`deep_search_job_id`);--> statement-breakpoint
CREATE INDEX `llm_generations_debate_job_id_idx` ON `llm_generations` (`debate_job_id`);--> statement-breakpoint
CREATE INDEX `llm_generations_idea_job_id_idx` ON `llm_generations` (`idea_job_id`);--> statement-breakpoint
CREATE INDEX `llm_generations_deep_search_job_id_idx` ON `llm_generations` (`deep_search_job_id`);--> statement-breakpoint
CREATE TABLE `research_job_admissions` (
	`research_job_admission_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "research_job_admissions_kind_check" CHECK("research_job_admissions"."kind" in ('deep-search', 'idea', 'debate'))
);
--> statement-breakpoint
CREATE INDEX `research_job_admissions_user_created_at_idx` ON `research_job_admissions` (`user_id`,`created_at`,`research_job_admission_id`);--> statement-breakpoint
CREATE INDEX `research_job_admissions_user_kind_created_at_idx` ON `research_job_admissions` (`user_id`,`kind`,`created_at`,`research_job_admission_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TRIGGER `deep_search_results_selected_web_page_owner_insert`
BEFORE INSERT ON `deep_search_results`
WHEN NEW.`selected_web_page_id` IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM `deep_search_web_pages`
	INNER JOIN `deep_search_queries`
		ON `deep_search_queries`.`deep_search_query_id` = NEW.`deep_search_query_id`
	INNER JOIN `deep_search_rounds`
		ON `deep_search_rounds`.`deep_search_round_id` = `deep_search_queries`.`deep_search_round_id`
	WHERE `deep_search_web_pages`.`deep_search_web_page_id` = NEW.`selected_web_page_id`
		AND `deep_search_web_pages`.`deep_search_job_id` = `deep_search_rounds`.`deep_search_job_id`
)
BEGIN
	SELECT RAISE(ABORT, 'selected result page must belong to the query deep-search job');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_results_selected_web_page_owner_update`
BEFORE UPDATE OF `deep_search_query_id`, `selected_web_page_id` ON `deep_search_results`
WHEN NEW.`selected_web_page_id` IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM `deep_search_web_pages`
	INNER JOIN `deep_search_queries`
		ON `deep_search_queries`.`deep_search_query_id` = NEW.`deep_search_query_id`
	INNER JOIN `deep_search_rounds`
		ON `deep_search_rounds`.`deep_search_round_id` = `deep_search_queries`.`deep_search_round_id`
	WHERE `deep_search_web_pages`.`deep_search_web_page_id` = NEW.`selected_web_page_id`
		AND `deep_search_web_pages`.`deep_search_job_id` = `deep_search_rounds`.`deep_search_job_id`
)
BEGIN
	SELECT RAISE(ABORT, 'selected result page must belong to the query deep-search job');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_results_selected_web_page_url_insert`
BEFORE INSERT ON `deep_search_results`
WHEN NEW.`selected_web_page_id` IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM `deep_search_web_pages`
	WHERE `deep_search_web_pages`.`deep_search_web_page_id` = NEW.`selected_web_page_id`
		AND `deep_search_web_pages`.`url` = NEW.`url`
)
BEGIN
	SELECT RAISE(ABORT, 'selected result page must match the result URL');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_results_selected_web_page_url_update`
BEFORE UPDATE OF `selected_web_page_id`, `url` ON `deep_search_results`
WHEN NEW.`selected_web_page_id` IS NOT NULL
AND NOT EXISTS (
	SELECT 1
	FROM `deep_search_web_pages`
	WHERE `deep_search_web_pages`.`deep_search_web_page_id` = NEW.`selected_web_page_id`
		AND `deep_search_web_pages`.`url` = NEW.`url`
)
BEGIN
	SELECT RAISE(ABORT, 'selected result page must match the result URL');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_round_structure_immutable`
BEFORE UPDATE OF `deep_search_job_id`, `position`, `llm_generation_id` ON `deep_search_rounds`
WHEN NEW.`deep_search_job_id` IS NOT OLD.`deep_search_job_id`
	OR NEW.`position` IS NOT OLD.`position`
	OR NEW.`llm_generation_id` IS NOT OLD.`llm_generation_id`
BEGIN
	SELECT RAISE(ABORT, 'deep-search structural columns are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_query_structure_immutable`
BEFORE UPDATE OF `deep_search_round_id`, `position`, `query` ON `deep_search_queries`
WHEN NEW.`deep_search_round_id` IS NOT OLD.`deep_search_round_id`
	OR NEW.`position` IS NOT OLD.`position`
	OR NEW.`query` IS NOT OLD.`query`
BEGIN
	SELECT RAISE(ABORT, 'deep-search structural columns are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_web_page_identity_immutable`
BEFORE UPDATE OF `deep_search_job_id`, `url` ON `deep_search_web_pages`
WHEN NEW.`deep_search_job_id` IS NOT OLD.`deep_search_job_id`
	OR NEW.`url` IS NOT OLD.`url`
BEGIN
	SELECT RAISE(ABORT, 'deep-search structural columns are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `llm_generation_owner_immutable`
BEFORE UPDATE OF `user_id`, `debate_job_id`, `idea_job_id`, `deep_search_job_id` ON `llm_generations`
WHEN NEW.`user_id` IS NOT OLD.`user_id`
	OR NEW.`debate_job_id` IS NOT OLD.`debate_job_id`
	OR NEW.`idea_job_id` IS NOT OLD.`idea_job_id`
	OR NEW.`deep_search_job_id` IS NOT OLD.`deep_search_job_id`
BEGIN
	SELECT RAISE(ABORT, 'LLM generation ownership columns are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `idea_terminal_insert_guard`
BEFORE INSERT ON `ideas`
WHEN EXISTS (
	SELECT 1
	FROM `idea_jobs`
	WHERE `idea_jobs`.`idea_job_id` = NEW.`idea_job_id`
		AND `idea_jobs`.`status` != 'running'
)
BEGIN
	SELECT RAISE(ABORT, 'terminal idea collections are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `idea_update_immutable`
BEFORE UPDATE ON `ideas`
WHEN NEW.`idea_id` IS NOT OLD.`idea_id`
	OR NEW.`idea_job_id` IS NOT OLD.`idea_job_id`
	OR NEW.`position` IS NOT OLD.`position`
	OR NEW.`title` IS NOT OLD.`title`
	OR NEW.`description` IS NOT OLD.`description`
	OR NEW.`created_at` IS NOT OLD.`created_at`
	OR NOT (
		(
			NEW.`critique_generation_id` IS OLD.`critique_generation_id`
			OR (OLD.`critique_generation_id` IS NULL AND NEW.`critique_generation_id` IS NOT NULL)
		)
		AND
		(
			NEW.`selected` IS OLD.`selected`
			OR (OLD.`selected` IS NULL AND NEW.`selected` IN (0, 1))
		)
		AND
		(
			NEW.`refinement_generation_id` IS OLD.`refinement_generation_id`
			OR (OLD.`refinement_generation_id` IS NULL AND NEW.`refinement_generation_id` IS NOT NULL)
		)
		AND
		(
			(NEW.`refined_title` IS OLD.`refined_title` AND NEW.`refined_description` IS OLD.`refined_description`)
			OR (
				OLD.`refined_title` IS NULL
				AND OLD.`refined_description` IS NULL
				AND NEW.`refined_title` IS NOT NULL
				AND NEW.`refined_description` IS NOT NULL
			)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'idea rows are immutable except for one-time pipeline linkage');
END;
--> statement-breakpoint
CREATE TRIGGER `idea_direct_delete_guard`
BEFORE DELETE ON `ideas`
WHEN EXISTS (
	SELECT 1
	FROM `idea_jobs`
	WHERE `idea_jobs`.`idea_job_id` = OLD.`idea_job_id`
)
BEGIN
	SELECT RAISE(ABORT, 'idea rows are immutable; delete the owning job');
END;
