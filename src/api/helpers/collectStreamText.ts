import type { TextStreamEvent } from "../llms/streams.ts"
import { subscribeToTextStream } from "../llms/streams.ts"
import z from "zod"

export const collectStreamText = z
  .function()
  .input(z.tuple([z.object({ id: z.string() })]))
  .output(z.string())
  .implementAsync(async (params) => {
    const stream = subscribeToTextStream(params.id)
    if (!stream) throw new Error("Stream not found")
    let text = ""
    for await (const event of stream as AsyncIterable<TextStreamEvent>) {
      if (event.type === "text") text += event.text
      if (event.type === "error") throw new Error(event.message)
      if (event.type === "done") break
    }
    return text
  })
