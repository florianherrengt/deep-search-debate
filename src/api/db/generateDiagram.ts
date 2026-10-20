import { writeFileSync } from "node:fs"
import { sqliteGenerate } from "drizzle-dbml-generator"
import * as schema from "./schema/index.ts"

const generated = sqliteGenerate({ schema })
const partialIndexAnnotations = [
  {
    rendered: "    debate_match_id [name: 'debate_messages_match_judge_idx', unique]",
    annotation: "    // Partial unique index omitted: debate_match_id WHERE speaker_slot = 2.",
  },
  {
    rendered: "    (refine_session_id, refine_batch_id, position) [name: 'refine_search_links_preparation_idx', unique]",
    annotation: "    // Partial unique index omitted: (refine_session_id, refine_batch_id, position) WHERE role = 'preparation'.",
  },
  {
    rendered: "    refine_session_id [name: 'refine_search_links_research_idx', unique]",
    annotation: "    // Partial unique index omitted: refine_session_id WHERE role = 'research'.",
  },
]
for (const { rendered } of partialIndexAnnotations) {
  if (!generated.includes(rendered)) throw new Error(`Could not annotate partial index: ${rendered}`)
}
let annotated = generated
for (const { rendered, annotation } of partialIndexAnnotations) {
  annotated = annotated.replace(rendered, annotation)
}

// drizzle-dbml-generator drops SQLite partial-index predicates. The generated
// DBML documents those indexes by their role predicates instead of claiming
// global uniqueness for all rows.
const dbml = `${annotated.replace(/[ \t]+$/gm, "")}

// SQLite checks omitted from DBML require waitlist_entries.email to equal its
// trimmed lowercase form and contain between 1 and 254 characters.
// openai_codex_connections requires a non-empty trimmed connection ID,
// non-empty ciphertext, a 12-byte nonce, and a 16-byte authentication tag; its
// three encrypted values must be BLOBs.
// deepseek_api_keys stores one encrypted key per user, with non-empty
// ciphertext, a 12-byte nonce, and a 16-byte authentication tag; all are BLOBs.
// llm_model_settings restricts both providers to deepseek or openai, restricts
// both reasoning efforts to none, minimal, low, medium, high, xhigh, max, or
// ultra, and requires both model IDs to remain non-empty after trimming.
// The fresh baseline migration also defines triggers that require selected
// result/page ownership, require tournament participants to be selected ideas
// from the debate's idea job, and freeze aggregate structure and generation
// ownership. DBML cannot represent SQLite triggers or partial-index predicates;
// the migration and schema regression tests are authoritative.
// The linked-page migration enforces same-job source, target, and round
// ownership, exact target URLs, and immutable discoveries/selections. The store
// checks selector-generation ownership in the selection transaction.
// original_passages is nullable and limited to 16,000 characters. Its additive
// migration preserves existing pages, links, and temporary extraction checks.
// captcha_task_id is null before an attempt, the exact empty string for a durable
// reservation with no known task ID, or a non-empty provider task ID. All non-null
// values consume the shared root allowance and remain reserved across Resume.
// idea_jobs.workflow is immutable research (legacy) or discovery. Discovery has
// one initial child and may enter ready with generated ideas but no selection.
// A ready standalone discovery can acquire a debate parent exactly once when
// entering running; existing parent links remain immutable.
// refine_sessions requires a non-empty trimmed prompt, a non-negative shared
// revision, and status clarifying, starting, or research-started. Final job ID
// and request are both null while clarifying and both present after Start.
// refine_batches requires a non-negative position and status preparing, ready,
// failed, or submitted. An error exists exactly when failed; answers exist
// exactly when submitted. refine_state_revisions.revision must be positive.
`
writeFileSync(new URL("./schema.dbml", import.meta.url), dbml)
