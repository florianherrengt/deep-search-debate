CREATE TABLE `debate_jobs` (
	`debate_job_id` text PRIMARY KEY NOT NULL,
	`idea_job_id` text NOT NULL,
	`random_seed` integer NOT NULL,
	`stage` text DEFAULT 'ideas' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`idea_job_id`) REFERENCES `idea_jobs`(`idea_job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debate_jobs_config_check" CHECK("debate_jobs"."random_seed" >= 0 and "debate_jobs"."random_seed" <= 4294967295),
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
CREATE UNIQUE INDEX `debate_jobs_idea_job_id_unique` ON `debate_jobs` (`idea_job_id`);--> statement-breakpoint
CREATE INDEX `debate_jobs_created_at_idx` ON `debate_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `debate_matches` (
	`debate_match_id` text PRIMARY KEY NOT NULL,
	`debate_round_id` text NOT NULL,
	`position` integer NOT NULL,
	`first_idea_id` text NOT NULL,
	`second_idea_id` text NOT NULL,
	`winner_idea_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
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
CREATE TABLE `debate_messages` (
	`debate_message_id` text PRIMARY KEY NOT NULL,
	`debate_match_id` text NOT NULL,
	`position` integer NOT NULL,
	`speaker_slot` integer NOT NULL,
	`llm_generation_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`debate_match_id`) REFERENCES `debate_matches`(`debate_match_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_generation_id`) REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE restrict,
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
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`debate_job_id`) REFERENCES `debate_jobs`(`debate_job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "debate_rounds_number_check" CHECK("debate_rounds"."stage_round_number" > 0),
	CONSTRAINT "debate_rounds_stage_check" CHECK("debate_rounds"."stage" in ('swiss', 'semifinal', 'final') and ("debate_rounds"."stage" = 'swiss' or "debate_rounds"."stage_round_number" = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debate_rounds_job_stage_number_idx` ON `debate_rounds` (`debate_job_id`,`stage`,`stage_round_number`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`idea_id` text PRIMARY KEY NOT NULL,
	`idea_job_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`idea_job_id`) REFERENCES `idea_jobs`(`idea_job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ideas_position_check" CHECK("ideas"."position" >= 0),
	CONSTRAINT "ideas_content_check" CHECK(length(trim("ideas"."title")) > 0 and length(trim("ideas"."description")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_job_position_idx` ON `ideas` (`idea_job_id`,`position`);