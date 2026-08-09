ALTER TABLE `idea_jobs` ADD `selection_generation_id` text REFERENCES llm_generations(llm_generation_id);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_selection_generation_id_unique` ON `idea_jobs` (`selection_generation_id`);--> statement-breakpoint
CREATE TRIGGER `idea_job_selection_owner_insert`
BEFORE INSERT ON `idea_jobs`
WHEN NEW.`selection_generation_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `llm_generations`
		WHERE `llm_generations`.`llm_generation_id` = NEW.`selection_generation_id`
			AND `llm_generations`.`user_id` = NEW.`user_id`
			AND `llm_generations`.`idea_job_id` = NEW.`idea_job_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'selection generation must belong to the idea job owner');
END;--> statement-breakpoint
CREATE TRIGGER `idea_job_selection_owner_update`
BEFORE UPDATE OF `selection_generation_id`, `user_id`, `idea_job_id` ON `idea_jobs`
WHEN NEW.`selection_generation_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `llm_generations`
		WHERE `llm_generations`.`llm_generation_id` = NEW.`selection_generation_id`
			AND `llm_generations`.`user_id` = NEW.`user_id`
			AND `llm_generations`.`idea_job_id` = NEW.`idea_job_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'selection generation must belong to the idea job owner');
END;--> statement-breakpoint
DROP TRIGGER `idea_update_immutable`;--> statement-breakpoint
ALTER TABLE `ideas` ADD `selected` integer;--> statement-breakpoint
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
	)
BEGIN
	SELECT RAISE(ABORT, 'idea rows are immutable except for one-time critique and selection linkage');
END;
