DROP INDEX `deep_search_jobs_user_slug_idx`;--> statement-breakpoint
WITH `ranked_deep_search_slugs` AS (
	SELECT
		`deep_search_job_id`,
		row_number() OVER (
			PARTITION BY `slug`
			ORDER BY `created_at`, `deep_search_job_id`
		) AS `duplicate_number`
	FROM `deep_search_jobs`
)
UPDATE `deep_search_jobs`
SET `slug` = substr(`slug`, 1, 43) || '-' || replace(`deep_search_job_id`, '-', '')
WHERE `deep_search_job_id` IN (
	SELECT `deep_search_job_id`
	FROM `ranked_deep_search_slugs`
	WHERE `duplicate_number` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_jobs_slug_idx` ON `deep_search_jobs` (`slug`);--> statement-breakpoint
DROP INDEX `idea_jobs_user_slug_idx`;--> statement-breakpoint
WITH `ranked_idea_slugs` AS (
	SELECT
		`idea_job_id`,
		row_number() OVER (
			PARTITION BY `slug`
			ORDER BY `created_at`, `idea_job_id`
		) AS `duplicate_number`
	FROM `idea_jobs`
)
UPDATE `idea_jobs`
SET `slug` = substr(`slug`, 1, 43) || '-' || replace(`idea_job_id`, '-', '')
WHERE `idea_job_id` IN (
	SELECT `idea_job_id`
	FROM `ranked_idea_slugs`
	WHERE `duplicate_number` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_jobs_slug_idx` ON `idea_jobs` (`slug`);
