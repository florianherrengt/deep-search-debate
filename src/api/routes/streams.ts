import { zValidator } from "@hono/zod-validator"
import { and, eq } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import z from "zod"
import { generateTextStream } from "../llms/generateText.ts"
import { PromptName } from "../llms/prompts.ts"
import { subscribeToTextStream } from "../llms/streams.ts"
import { db } from "../db/index.ts"
import { llmGenerations } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"

const createTextStreamInputSchema = z.object({
  prompt: z.string(),
  promptName: z.enum(PromptName).default(PromptName.Default),
})

const textStreamParamsSchema = z.object({ id: z.uuid() })

export function streams(app: Hono<AppEnv>) {
  app.post(
    "/streams",
    zValidator("json", createTextStreamInputSchema),
    async (c) => {
      const input = c.req.valid("json")
      const textStream = await generateTextStream({
        ...input,
        userId: c.get("userId"),
        owner: { standalone: true },
      })

      c.header("Location", `/api/streams/${textStream.id}`)
      return c.json(textStream, 201)
    },
  )

  app.get("/streams/:id", zValidator("param", textStreamParamsSchema), (c) => {
    const { id } = c.req.valid("param")
    const owned = db
      .select({ id: llmGenerations.llmGenerationId })
      .from(llmGenerations)
      .where(
        and(
          eq(llmGenerations.llmGenerationId, id),
          eq(llmGenerations.userId, c.get("userId")),
        ),
      )
      .get()
    const events = owned ? subscribeToTextStream(id) : undefined

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
