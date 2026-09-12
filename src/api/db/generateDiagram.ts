import { writeFileSync } from "node:fs"
import { sqliteGenerate } from "drizzle-dbml-generator"
import * as schema from "./schema/index.ts"

const generated = sqliteGenerate({ schema })
const unconditionalJudgeIndex =
  "    debate_match_id [name: 'debate_messages_match_judge_idx', unique]"
if (!generated.includes(unconditionalJudgeIndex)) {
  throw new Error("Could not annotate the partial debate judge index")
}

// drizzle-dbml-generator drops SQLite partial-index predicates. Omitting the
// rendered index is more accurate than claiming every message has a globally
// unique match ID; the canonical schema limits uniqueness to judge rows.
const dbml = `${generated.replace(
  unconditionalJudgeIndex,
  "    // Partial unique index omitted: debate_match_id WHERE speaker_slot = 2.",
).replace(/[ \t]+$/gm, "")}

// SQLite checks omitted from DBML require waitlist_entries.email to equal its
// trimmed lowercase form and contain between 1 and 254 characters.
// openai_codex_connections requires a non-empty trimmed connection ID,
// non-empty ciphertext, a 12-byte nonce, and a 16-byte authentication tag; its
// three encrypted values must be BLOBs.
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
`
writeFileSync(new URL("./schema.dbml", import.meta.url), dbml)
