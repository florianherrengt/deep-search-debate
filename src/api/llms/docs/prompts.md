# Prompts

Prompts are plain `.md` files in `src/api/llms/prompts/`, loaded at runtime by `loadPrompt(name)`, which resolves `${name}.md` in that directory.

## Adding a prompt

You must do **both**:

1. Add a value to the `PromptName` enum in `src/api/llms/prompts.ts` (stream creation validates `promptName` against this enum via zod).
2. Create the matching `src/api/llms/prompts/<name>.md` file.

The enum value and the filename (minus `.md`) must be identical, or `loadPrompt` will fail at request time.

## LLM calls

The LLM provider and model are selected by `LLM_PROVIDER` and
`LLM_MODEL_NAME`. `generateTextStream` (`src/api/llms/generateText.ts`) requests
reasoning and registers the provider stream immediately before returning its
stream ID. The provider adapter translates that call-level intent into DeepSeek
thinking or OpenCode Zen reasoning effort. Enabled reasoning requests the
maximum DeepSeek thinking strength (`thinking.type=enabled` with
`reasoning_effort=max`); disabled reasoning sends `thinking.type=disabled`.
See `routes/docs/text-streaming.md` for the client contract.

For durable streams, `promptName` is also the operational stage name stored on
`llm_generations` and emitted in the terminal lifecycle log. Prompts and model
outputs themselves are never included in that log.

`generatePromptTitle`, `generateArrayStream`, and `generateObjectStream` request
reasoning-disabled calls and schema-validated output. Job creation awaits the
short title preflight call before inserting the durable job and returning its
slug. Title generation is not exposed as a user-visible stream. The provider
adapter maps disabled reasoning to DeepSeek `thinking.type=disabled` or Zen
`reasoning_effort=none`.

Structured output is a strict model contract. Malformed JSON or output that
fails its Zod schema fails the generation and its owning workflow. Application
code must not repair malformed output, normalize or default schema-invalid
values, filter invalid values, or retry because parsing or validation failed.
Change the prompt or schema deliberately when the contract is wrong; switch the
configured model when it cannot satisfy the contract. Provider-request retries
remain governed separately by the configured AI SDK retry policy.
