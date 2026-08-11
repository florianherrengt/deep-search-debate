import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import z from "zod"
import { config } from "../config.ts"
import { generateTextStream } from "../llms/generateText.ts"
import { PromptName } from "../llms/prompts.ts"
import { subscribeToTextStream } from "../llms/streams.ts"
import type { AppEnv } from "../types/auth.ts"
import { llmGenerationReadScope } from "./readAccess.ts"
import { reserveStandaloneGenerationCapacity } from "./researchCapacity.ts"

const createTextStreamInputSchema = z.object({
  prompt: z.string().trim().min(1).max(config.deepSearch.maxRequestChars),
  promptName: z.enum(PromptName).default(PromptName.Default),
})

const textStreamParamsSchema = z.object({ id: z.uuid() })

/** Registers stream reads inherited from a public debate aggregate. */
export function streamReads(app: Hono<AppEnv>) {
  app.get("/streams/:id", zValidator("param", textStreamParamsSchema), (c) => {
    const { id } = c.req.valid("param")
    const events = subscribeToTextStream(
      id,
      llmGenerationReadScope(c.get("viewerUserId")),
    )

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

/** Registers authenticated standalone stream creation. */
export function streams(app: Hono<AppEnv>) {
  app.post(
    "/streams",
    zValidator("json", createTextStreamInputSchema),
    async (c) => {
      const input = c.req.valid("json")
      const releaseCapacity = reserveStandaloneGenerationCapacity(
        c.get("userId"),
      )
      let textStream
      try {
        textStream = await generateTextStream({
          ...input,
          userId: c.get("userId"),
          owner: { standalone: true },
          reasoning: "enabled",
        })
      } finally {
        releaseCapacity()
      }

      c.header("Location", `/api/streams/${textStream.id}`)
      return c.json({ id: textStream.id }, 201)
    },
  )
}
