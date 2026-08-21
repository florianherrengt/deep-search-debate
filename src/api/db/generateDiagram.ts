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
// The baseline migration also defines triggers that require a selected result
// and page to share a URL and deep-search job, freeze the ownership chain used
// by that check and every LLM generation, and freeze ideas after their job
// completes. DBML cannot represent SQLite triggers; the migration and schema
// regression tests are authoritative.
`
writeFileSync(new URL("./schema.dbml", import.meta.url), dbml)
