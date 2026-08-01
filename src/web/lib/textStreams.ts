import { postForId, subscribeToNdjson } from "./api.ts"

type PromptName = "default" | "generate-websearch-queries"

export type TextStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" }

export type CreateTextStreamInput = {
  prompt: string
  promptName?: PromptName
}

export async function createTextStream(
  input: CreateTextStreamInput,
  signal?: AbortSignal,
): Promise<string> {
  return postForId(
    "/api/streams",
    {
      prompt: input.prompt,
      promptName: input.promptName ?? "default",
    },
    signal,
  )
}

export async function* subscribeToTextStream(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  yield* subscribeToNdjson<TextStreamEvent>(
    `/api/streams/${encodeURIComponent(id)}`,
    signal,
  )
}
