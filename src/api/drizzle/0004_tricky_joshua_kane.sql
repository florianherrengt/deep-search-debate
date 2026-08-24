ALTER TABLE `debate_jobs` ADD `website_generation_id` text REFERENCES llm_generations(llm_generation_id);--> statement-breakpoint
CREATE UNIQUE INDEX `debate_jobs_website_generation_id_unique` ON `debate_jobs` (`website_generation_id`);
