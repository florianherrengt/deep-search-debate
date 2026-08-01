import type { TextStreamEvent } from "./textStreams.ts"

export type TextStreamContent = {
  text: string
  reasoning: string
}

/** Accumulates text-stream events and reports each new content snapshot. */
export async function accumulateTextStream(
  events: AsyncIterable<TextStreamEvent>,
  onUpdate: (content: TextStreamContent) => void,
): Promise<TextStreamContent> {
  let text = ""
  let reasoning = ""

  for await (const event of events) {
    switch (event.type) {
      case "reasoning":
        reasoning += event.text
        break
      case "text":
        text += event.text
        break
      case "error":
        throw new Error(event.message)
      case "done":
        return { text, reasoning }
    }

    onUpdate({ text, reasoning })
  }

  return { text, reasoning }
}
