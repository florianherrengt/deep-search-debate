import type { Hono } from "hono"
import z from "zod"
import { generateTextStream } from "../llms/generateText.ts"

const ChatInput = z.object({
  prompt: z.string(),
})

export function chat(app: Hono) {
  app.post("/chat", async (c) => {
    const body = ChatInput.parse(await c.req.json())
    const result = await generateTextStream(body)
    return result.toTextStreamResponse()
  })
}
