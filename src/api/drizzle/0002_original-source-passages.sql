-- Add the bounded retained passages without rebuilding pages or their links.
ALTER TABLE `deep_search_web_pages` ADD `original_passages` text
  CONSTRAINT `deep_search_web_pages_original_passages_check`
  CHECK("deep_search_web_pages"."original_passages" is null or length("deep_search_web_pages"."original_passages") <= 16000);
