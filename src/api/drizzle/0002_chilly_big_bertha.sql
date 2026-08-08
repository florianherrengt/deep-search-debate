DROP TRIGGER `idea_update_immutable`;--> statement-breakpoint
ALTER TABLE `ideas` ADD `critique_generation_id` text REFERENCES llm_generations(llm_generation_id);--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_critique_generation_id_unique` ON `ideas` (`critique_generation_id`);--> statement-breakpoint
CREATE TRIGGER `idea_update_immutable`
BEFORE UPDATE ON `ideas`
WHEN NEW.`idea_id` IS NOT OLD.`idea_id`
	OR NEW.`idea_job_id` IS NOT OLD.`idea_job_id`
	OR NEW.`position` IS NOT OLD.`position`
	OR NEW.`title` IS NOT OLD.`title`
	OR NEW.`description` IS NOT OLD.`description`
	OR NEW.`created_at` IS NOT OLD.`created_at`
	OR OLD.`critique_generation_id` IS NOT NULL
	OR NEW.`critique_generation_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'idea rows are immutable except for one-time critique linkage');
END;
