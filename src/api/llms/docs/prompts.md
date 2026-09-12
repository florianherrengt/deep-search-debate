# Prompts

Prompts are plain `.md` files in `src/api/llms/prompts/`, loaded at runtime by `loadPrompt(name)`, which resolves `${name}.md` in that directory.

## Adding a prompt

You must do **both**:

1. Add a value to the `PromptName` enum in `src/api/llms/prompts.ts` (stream creation validates `promptName` against this enum via zod).
2. Create the matching `src/api/llms/prompts/<name>.md` file.

The enum value and the filename (minus `.md`) must be identical, or `loadPrompt` will fail at request time.

## LLM calls

`PromptName` exhaustively selects one of two user-configurable roles. Small is
used for prompt titles, search-result and discovered-link filtering, page summaries, query
summaries, and idea-research briefing summaries. Big is used for the default
standalone stream, research planning and synthesis, final source-backed answer
correction (`correct-research-answer`), research audits and round
reviews, idea planning/generation/evaluation/selection/refinement/site output,
and every debate opening, rebuttal, and judgment. Additions to `PromptName` must
also be added to `modelRoleForPrompt`; its exhaustive switch makes omissions a
type error.

The role stores an exact provider, model ID, and reasoning effort. Each
generation snapshots that choice before provider reservation, and the role
effort overrides older per-call enabled/disabled hints. DeepSeek `none` maps to
disabled thinking; its other advertised efforts map to enabled thinking with
the exact effort. Codex receives the exact effort advertised for the selected
OpenAI model. `generateTextStream` registers the resolved provider stream
immediately before returning its stream ID. See
`routes/docs/text-streaming.md` for the client contract.

For durable streams, `promptName` is also the operational stage name stored on
`llm_generations`. Failed metadata-bearing generations include that stage name
in their privacy-safe error record. Prompts and model outputs themselves are
never included in application logs.

`generatePromptTitle`, `generateArrayStream`, and `generateObjectStream` produce
schema-validated output. Job creation awaits the short title preflight call
before inserting the durable job and returning its slug. Title generation is
not exposed as a user-visible stream.

Structured output is a strict model contract. Malformed JSON or output that
fails its Zod schema fails the generation and its owning workflow. Application
code must not repair malformed output, normalize or default schema-invalid
values, filter invalid values, or retry because parsing or validation failed.
Change the prompt or schema deliberately when the contract is wrong; switch the
configured model when it cannot satisfy the contract. Provider-request retries
remain governed separately by the configured Pi retry policy.


## Deep-search structured contracts

`generate-websearch-queries` returns a version-1 object containing `requirements`
and an ordered `queries` array. Queries must match the requested count, be
non-empty, and be distinct within the round and from prior queries. Requirements
distinguish explicit requirements from preferences and record supported,
unresolved, or conflicting status, source URLs, and an explanation. Planning,
review, and final-analysis generation JSON retain this checklist; no separate
checklist table is written. The completed-plan reader also accepts legacy
`{elements:[...]}` and bare query arrays, with no invented requirements. Legacy review and analysis payloads
may omit the checklist; new model output must include it.

New `review-deep-search-round` output uses version 1 with `requirements`,
`reason`, and up to 12 material `gaps`, each containing a title, description,
and nullable `evidenceToFind` target. It omits the model's decision: the
application derives continuation whenever a gap has an external evidence
target, and passes those descriptions and targets to the next planner through
the existing review reason. Null targets explain uncertainty that further web
research cannot resolve. This gap audit happens before stopping; the final
analysis still audits the corrected answer. Unversioned saved reviews keep
their original decision/reason, while unknown versions fail validation.

Result selection receives known page URLs and statuses, the requirements, and
review findings. Linked-page selection receives actual discovered IDs, the
requirements, and known page statuses with available titles and completed
summaries. Its source and known-page summaries share the existing context bound,
helping it choose additional evidence over redundant page variants without
assuming that similar URLs identify the same document.
Page summarization selects query-relevant original passages under
a 100,000-character input bound. Cumulative research prompts retain source URLs,
evidence types, and bounded original passages alongside summaries. Passage
retention is refined when a summary completes, using the request and that
summary to locate supporting original text. Final context narrowing uses the
same vocabulary before shortening the displayed summary; generated text never
becomes an original passage.

Every newly finalized search calls `correct-research-answer` after exploration
ends, then analyzes the corrected text with `analyze-research-answer`. The
correction preserves supported findings, checks decisive claims against original
passages where available, and qualifies unresolved requirements and evidence. It
is one bounded pass without additional retrieval. Its output is the delivered
answer; the round candidate remains immutable. Both generations use existing
durable job links and reuse completed output on Resume. See
[the pipeline contract](../../routes/docs/deep-search-pipeline.md) for the legacy
completed-analysis checkpoint exception.
