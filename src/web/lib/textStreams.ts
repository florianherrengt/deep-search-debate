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
  const response = await fetch("/api/streams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: input.prompt,
      promptName: input.promptName ?? "default",
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Stream creation failed: ${response.status}`)
  }

  const body = (await response.json()) as unknown
  if (
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    typeof body.id !== "string"
  ) {
    throw new Error("Stream response has no ID")
  }

  return body.id
}

export async function* subscribeToTextStream(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  const response = await fetch(`/api/streams/${encodeURIComponent(id)}`, {
    signal,
  })
  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.status}`)
  }
  if (!response.body) throw new Error("Stream response has no body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const event = line.trim()
      if (event) yield JSON.parse(event) as TextStreamEvent
    }
  }

  const event = buffer.trim()
  if (event) yield JSON.parse(event) as TextStreamEvent
}
