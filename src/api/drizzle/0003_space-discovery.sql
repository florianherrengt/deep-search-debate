-- Keep idea_jobs in place: rebuilding it would cascade into saved research.
-- SQLite's documented metadata-only ALTER procedure changes these CHECKs without
-- rewriting records. Exact-source guards reject an unexpected prior schema.
-- https://www.sqlite.org/lang_altertable.html#otheralter
CREATE TEMP TABLE `discovery_migration_guard` (`valid` integer NOT NULL CHECK (`valid` = 1));
--> statement-breakpoint
INSERT INTO `discovery_migration_guard` SELECT count(*) = 1 FROM sqlite_schema
WHERE type = 'table' AND name = 'idea_jobs'
AND (length(sql) - length(replace(sql, 'CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in (''running'', ''completed'', ''failed'', ''interrupted''))', ''))) = length('CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in (''running'', ''completed'', ''failed'', ''interrupted''))')
AND (length(sql) - length(replace(sql, 'CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = ''running'' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = ''completed'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and "idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is not null)
        or
        ("idea_jobs"."status" = ''failed'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null and "idea_jobs"."cancel_requested_at" is null)
        or
        ("idea_jobs"."status" = ''interrupted'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))', ''))) = length('CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = ''running'' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = ''completed'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and "idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is not null)
        or
        ("idea_jobs"."status" = ''failed'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null and "idea_jobs"."cancel_requested_at" is null)
        or
        ("idea_jobs"."status" = ''interrupted'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))');
--> statement-breakpoint
ALTER TABLE `idea_jobs` ADD `workflow` text DEFAULT 'research' NOT NULL
CONSTRAINT "idea_jobs_workflow_check" CHECK("idea_jobs"."workflow" in ('research', 'discovery') and ("idea_jobs"."workflow" != 'discovery' or "idea_jobs"."deep_search_count" = 1));
--> statement-breakpoint
PRAGMA writable_schema=ON;
--> statement-breakpoint
UPDATE sqlite_schema SET sql = replace(replace(sql,
'CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in (''running'', ''completed'', ''failed'', ''interrupted''))',
'CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in (''running'', ''completed'', ''failed'', ''interrupted'', ''ready''))'),
'CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = ''running'' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = ''completed'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and "idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is not null)
        or
        ("idea_jobs"."status" = ''failed'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null and "idea_jobs"."cancel_requested_at" is null)
        or
        ("idea_jobs"."status" = ''interrupted'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))',
'CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = ''running'' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = ''completed'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and ("idea_jobs"."workflow" = ''discovery'' or ("idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null)) and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is not null)
        or
        ("idea_jobs"."status" = ''ready'' and "idea_jobs"."workflow" = ''discovery'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."debate_job_id" is null and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is null)
        or
        ("idea_jobs"."status" = ''failed'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null and "idea_jobs"."cancel_requested_at" is null)
        or
        ("idea_jobs"."status" = ''interrupted'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))')
WHERE type = 'table' AND name = 'idea_jobs';
--> statement-breakpoint
-- RESET disables schema writes and reparses the edited CHECKs. The following
-- ordinary trigger DDL advances schema_version for all other connections.
PRAGMA writable_schema=RESET;
--> statement-breakpoint
DROP TRIGGER `idea_job_parent_immutable`;
--> statement-breakpoint
CREATE TRIGGER `idea_job_parent_immutable`
BEFORE UPDATE OF `debate_job_id` ON `idea_jobs`
WHEN NEW.`debate_job_id` IS NOT OLD.`debate_job_id`
  AND NOT (
    OLD.`debate_job_id` IS NULL AND NEW.`debate_job_id` IS NOT NULL
    AND OLD.`workflow` = 'discovery' AND NEW.`workflow` = 'discovery'
    AND OLD.`status` = 'ready' AND NEW.`status` = 'running'
    AND NEW.`user_id` IS OLD.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'Idea-job parent columns are immutable except when starting a ready discovery debate');
END;
--> statement-breakpoint
CREATE TRIGGER `idea_job_workflow_immutable`
BEFORE UPDATE OF `workflow` ON `idea_jobs`
WHEN NEW.`workflow` IS NOT OLD.`workflow`
BEGIN
  SELECT RAISE(ABORT, 'Idea-job workflow is immutable');
END;
--> statement-breakpoint
INSERT INTO `discovery_migration_guard` SELECT count(*) = 1 FROM sqlite_schema
WHERE type = 'table' AND name = 'idea_jobs'
AND instr(sql, 'CONSTRAINT "idea_jobs_status_check" CHECK("idea_jobs"."status" in (''running'', ''completed'', ''failed'', ''interrupted'', ''ready''))') > 0
AND instr(sql, 'CONSTRAINT "idea_jobs_terminal_fields_check" CHECK((
        ("idea_jobs"."status" = ''running'' and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null)
        or
        ("idea_jobs"."status" = ''completed'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and ("idea_jobs"."workflow" = ''discovery'' or ("idea_jobs"."research_prompt_generation_id" is not null and "idea_jobs"."research_summary_generation_id" is not null)) and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is not null)
        or
        ("idea_jobs"."status" = ''ready'' and "idea_jobs"."workflow" = ''discovery'' and "idea_jobs"."stage" = ''ideas'' and "idea_jobs"."debate_job_id" is null and "idea_jobs"."completed_at" is null and "idea_jobs"."error" is null and "idea_jobs"."cancel_requested_at" is null and "idea_jobs"."idea_generation_id" is not null and "idea_jobs"."selection_generation_id" is null)
        or
        ("idea_jobs"."status" = ''failed'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null and "idea_jobs"."cancel_requested_at" is null)
        or
        ("idea_jobs"."status" = ''interrupted'' and "idea_jobs"."completed_at" is not null and "idea_jobs"."error" is not null)
      ))') > 0;
--> statement-breakpoint
INSERT INTO `discovery_migration_guard` SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check);
--> statement-breakpoint
INSERT INTO `discovery_migration_guard` SELECT count(*) = 1 AND min(integrity_check) = 'ok' FROM pragma_integrity_check;
--> statement-breakpoint
DROP TABLE `discovery_migration_guard`;
