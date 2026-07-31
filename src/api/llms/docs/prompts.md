# Prompts

Prompts are plain `.md` files in `src/api/llms/prompts/`, loaded at runtime by `loadPrompt(name)`, which resolves `${name}.md` in that directory.

## Adding a prompt

You must do **both**:

1. Add a value to the `PromptName` enum in `src/api/llms/prompts.ts` (stream creation validates `promptName` against this enum via zod).
2. Create the matching `src/api/llms/prompts/<name>.md` file.

The enum value and the filename (minus `.md`) must be identical, or `loadPrompt` will fail at request time.

## LLM calls

`generateTextStream` (`src/api/llms/generateText.ts`) invokes DeepSeek via the AI SDK with thinking enabled (`providerOptions: { deepseek: { thinking: { type: "enabled" } } }`). It registers and starts consuming the provider stream immediately, then returns its stream ID. See `routes/docs/text-streaming.md` for the client contract.
