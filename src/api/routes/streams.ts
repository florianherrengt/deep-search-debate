import type { Hono } from "hono"
import { stream } from "hono/streaming"
import z from "zod"
import { generateTextStream } from "../llms/generateText.ts"
import { PromptName } from "../llms/prompts.ts"
import { subscribeToTextStream } from "../llms/streams.ts"

const createTextStreamInputSchema = z.object({
  prompt: z.string(),
  promptName: z.enum(PromptName).default(PromptName.Default),
})

export function streams(app: Hono) {
  app.post("/streams", async (c) => {
    const input = createTextStreamInputSchema.parse(await c.req.json())
    const textStream = await generateTextStream(input)

    c.header("Location", `/api/streams/${textStream.id}`)
    return c.json(textStream, 201)
  })

  app.get("/streams/:id", (c) => {
    const events = subscribeToTextStream(c.req.param("id"))

    if (!events) {
      return c.json({ error: "Stream not found" }, 404)
    }

    c.header("Content-Type", "application/x-ndjson")
    return stream(c, async (output) => {
      for await (const event of events) {
        await output.writeln(JSON.stringify(event))
      }
    })
  })
}
