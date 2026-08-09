ALTER TABLE `debate_jobs`
ADD `is_public` integer DEFAULT false NOT NULL
CONSTRAINT `debate_jobs_visibility_check`
CHECK (`is_public` in (0, 1));
