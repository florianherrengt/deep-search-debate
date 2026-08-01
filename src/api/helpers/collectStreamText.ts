import { subscribeToTextStream } from "../llms/streams.ts"

export async function collectStreamText(params: { id: string }): Promise<string> {
  const stream = subscribeToTextStream(params.id)
  if (!stream) throw new Error("Stream not found")
  let text = ""
  for await (const event of stream) {
    if (event.type === "text") text += event.text
    if (event.type === "error") throw new Error(event.message)
    if (event.type === "done") break
  }
  return text
}
