# Prompts

Prompts are plain `.md` files in `src/api/llms/prompts/`, loaded at runtime by `loadPrompt(name)`, which resolves `${name}.md` in that directory.

## Adding a prompt

You must do **both**:

1. Add a value to the `PromptName` enum in `src/api/llms/prompts.ts` (stream creation validates `promptName` against this enum via zod).
2. Create the matching `src/api/llms/prompts/<name>.md` file.

The enum value and the filename (minus `.md`) must be identical, or `loadPrompt` will fail at request time.

## LLM calls

`PromptName` exhaustively selects one of two user-configurable roles. Small is
used for prompt titles, search-result filtering, page summaries, query
summaries, and idea-research briefing summaries. Big is used for the default
standalone stream, research planning and synthesis, research audits and round
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
remain governed separately by the configured AI SDK retry policy.
