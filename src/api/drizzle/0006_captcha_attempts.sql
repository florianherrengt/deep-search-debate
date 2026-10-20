-- NULL means no attempt; the empty string durably reserves an attempt whose
-- createTask outcome is unknown. SQLite's additive column change preserves
-- page-selection triggers and existing data.
ALTER TABLE `deep_search_web_pages` ADD `captcha_task_id` text
  CONSTRAINT `deep_search_web_pages_captcha_task_check`
  CHECK(
    `captcha_task_id` is null
    or `captcha_task_id` = ''
    or (length(trim(`captcha_task_id`)) > 0 and length(`captcha_task_id`) <= 200)
  );
