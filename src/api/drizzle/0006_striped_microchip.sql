ALTER TABLE `ideas` ADD `refinement_generation_id` text REFERENCES `llm_generations`(`llm_generation_id`) ON UPDATE no action ON DELETE no action;--> statement-breakpoint
ALTER TABLE `ideas` ADD `refined_title` text;--> statement-breakpoint
ALTER TABLE `ideas` ADD `refined_description` text;--> statement-breakpoint
ALTER TABLE `ideas` ADD `deep_search_job_id` text REFERENCES `deep_search_jobs`(`deep_search_job_id`) ON UPDATE no action ON DELETE no action CONSTRAINT "ideas_refinement_lifecycle_check" CHECK((
	(`refinement_generation_id` is null and `refined_title` is null and `refined_description` is null and `deep_search_job_id` is null)
	or
	(`selected` = 1 and `refinement_generation_id` is not null and (
		(`refined_title` is null and `refined_description` is null and `deep_search_job_id` is null)
		or
		(`refined_title` is not null and length(trim(`refined_title`)) > 0 and `refined_description` is not null and length(trim(`refined_description`)) > 0)
	))
));--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_refinement_generation_id_unique` ON `ideas` (`refinement_generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ideas_deep_search_job_id_unique` ON `ideas` (`deep_search_job_id`);--> statement-breakpoint
CREATE TRIGGER `idea_refinement_generation_owner_insert`
BEFORE INSERT ON `ideas`
WHEN NEW.`refinement_generation_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `llm_generations`
		WHERE `llm_generations`.`llm_generation_id` = NEW.`refinement_generation_id`
			AND `llm_generations`.`idea_job_id` = NEW.`idea_job_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'idea refinement generation must belong to the owning idea job');
END;--> statement-breakpoint
CREATE TRIGGER `idea_refinement_generation_owner_update`
BEFORE UPDATE OF `refinement_generation_id` ON `ideas`
WHEN NEW.`refinement_generation_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `llm_generations`
		WHERE `llm_generations`.`llm_generation_id` = NEW.`refinement_generation_id`
			AND `llm_generations`.`idea_job_id` = NEW.`idea_job_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'idea refinement generation must belong to the owning idea job');
END;--> statement-breakpoint
CREATE TRIGGER `idea_deep_search_owner_insert`
BEFORE INSERT ON `ideas`
WHEN NEW.`deep_search_job_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `deep_search_jobs`
		INNER JOIN `idea_jobs`
			ON `idea_jobs`.`idea_job_id` = NEW.`idea_job_id`
		WHERE `deep_search_jobs`.`deep_search_job_id` = NEW.`deep_search_job_id`
			AND `deep_search_jobs`.`idea_job_id` = NEW.`idea_job_id`
			AND `deep_search_jobs`.`idea_job_position` = `idea_jobs`.`deep_search_count` + NEW.`position`
	)
BEGIN
	SELECT RAISE(ABORT, 'idea deep search must belong to the owning idea and position');
END;--> statement-breakpoint
CREATE TRIGGER `idea_deep_search_owner_update`
BEFORE UPDATE OF `deep_search_job_id` ON `ideas`
WHEN NEW.`deep_search_job_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `deep_search_jobs`
		INNER JOIN `idea_jobs`
			ON `idea_jobs`.`idea_job_id` = NEW.`idea_job_id`
		WHERE `deep_search_jobs`.`deep_search_job_id` = NEW.`deep_search_job_id`
			AND `deep_search_jobs`.`idea_job_id` = NEW.`idea_job_id`
			AND `deep_search_jobs`.`idea_job_position` = `idea_jobs`.`deep_search_count` + NEW.`position`
	)
BEGIN
	SELECT RAISE(ABORT, 'idea deep search must belong to the owning idea and position');
END;--> statement-breakpoint
DROP TRIGGER `idea_update_immutable`;--> statement-breakpoint
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
		AND
		(
			NEW.`deep_search_job_id` IS OLD.`deep_search_job_id`
			OR (OLD.`deep_search_job_id` IS NULL AND NEW.`deep_search_job_id` IS NOT NULL)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'idea rows are immutable except for one-time pipeline linkage');
END;
