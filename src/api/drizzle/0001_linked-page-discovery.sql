CREATE TABLE `deep_search_page_links` (
	`deep_search_page_link_id` text PRIMARY KEY NOT NULL,
	`source_web_page_id` text NOT NULL,
	`position` integer NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`selected_web_page_id` text,
	`selected_round_id` text,
	FOREIGN KEY (`source_web_page_id`) REFERENCES `deep_search_web_pages`(`deep_search_web_page_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_web_page_id`) REFERENCES `deep_search_web_pages`(`deep_search_web_page_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_round_id`) REFERENCES `deep_search_rounds`(`deep_search_round_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deep_search_page_links_position_check" CHECK("deep_search_page_links"."position" >= 0),
	CONSTRAINT "deep_search_page_links_content_check" CHECK(length(trim("deep_search_page_links"."url")) > 0 and length("deep_search_page_links"."url") <= 2048 and length(trim("deep_search_page_links"."title")) > 0 and length("deep_search_page_links"."title") <= 500),
	CONSTRAINT "deep_search_page_links_selection_check" CHECK(("deep_search_page_links"."selected_web_page_id" is null and "deep_search_page_links"."selected_round_id" is null) or ("deep_search_page_links"."selected_web_page_id" is not null and "deep_search_page_links"."selected_round_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_page_links_source_url_idx` ON `deep_search_page_links` (`source_web_page_id`,`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_page_links_source_position_idx` ON `deep_search_page_links` (`source_web_page_id`,`position`);--> statement-breakpoint
CREATE INDEX `deep_search_page_links_selected_web_page_id_idx` ON `deep_search_page_links` (`selected_web_page_id`);--> statement-breakpoint
CREATE INDEX `deep_search_page_links_selected_round_id_idx` ON `deep_search_page_links` (`selected_round_id`);--> statement-breakpoint
ALTER TABLE `deep_search_web_pages` ADD `link_selection_generation_id` text REFERENCES llm_generations(llm_generation_id);--> statement-breakpoint
CREATE UNIQUE INDEX `deep_search_web_pages_link_selection_generation_id_idx` ON `deep_search_web_pages` (`link_selection_generation_id`);
--> statement-breakpoint
CREATE TRIGGER `deep_search_page_link_identity_immutable`
BEFORE UPDATE OF `source_web_page_id`, `position`, `url`, `title` ON `deep_search_page_links`
WHEN NEW.`source_web_page_id` IS NOT OLD.`source_web_page_id`
  OR NEW.`position` IS NOT OLD.`position`
  OR NEW.`url` IS NOT OLD.`url`
  OR NEW.`title` IS NOT OLD.`title`
BEGIN
  SELECT RAISE(ABORT, 'discovered page link identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_page_link_selection_immutable`
BEFORE UPDATE OF `selected_web_page_id`, `selected_round_id` ON `deep_search_page_links`
WHEN OLD.`selected_web_page_id` IS NOT NULL
  AND (NEW.`selected_web_page_id` IS NOT OLD.`selected_web_page_id`
    OR NEW.`selected_round_id` IS NOT OLD.`selected_round_id`)
BEGIN
  SELECT RAISE(ABORT, 'selected page link is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_page_link_selected_owner_insert`
BEFORE INSERT ON `deep_search_page_links`
WHEN NEW.`selected_web_page_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `deep_search_web_pages` AS source
  JOIN `deep_search_web_pages` AS target
    ON target.`deep_search_job_id` = source.`deep_search_job_id`
  JOIN `deep_search_rounds` AS round
    ON round.`deep_search_job_id` = source.`deep_search_job_id`
  WHERE source.`deep_search_web_page_id` = NEW.`source_web_page_id`
    AND target.`deep_search_web_page_id` = NEW.`selected_web_page_id`
    AND target.`url` = NEW.`url`
    AND round.`deep_search_round_id` = NEW.`selected_round_id`
)
BEGIN
  SELECT RAISE(ABORT, 'selected page link must match its URL and owning job');
END;
--> statement-breakpoint
CREATE TRIGGER `deep_search_page_link_selected_owner_update`
BEFORE UPDATE OF `selected_web_page_id`, `selected_round_id` ON `deep_search_page_links`
WHEN NEW.`selected_web_page_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `deep_search_web_pages` AS source
  JOIN `deep_search_web_pages` AS target
    ON target.`deep_search_job_id` = source.`deep_search_job_id`
  JOIN `deep_search_rounds` AS round
    ON round.`deep_search_job_id` = source.`deep_search_job_id`
  WHERE source.`deep_search_web_page_id` = NEW.`source_web_page_id`
    AND target.`deep_search_web_page_id` = NEW.`selected_web_page_id`
    AND target.`url` = NEW.`url`
    AND round.`deep_search_round_id` = NEW.`selected_round_id`
)
BEGIN
  SELECT RAISE(ABORT, 'selected page link must match its URL and owning job');
END;
