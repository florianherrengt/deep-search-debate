import { zValidator } from "@hono/zod-validator"
import { desc, eq } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import { ideaJobs as ideaJobsTable } from "../../db/schema/index.ts"
import type { IdeaJobManager } from "./manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import {
  createIdeaJobInputSchema,
  ideaJobParamsSchema,
  listIdeaJobsInputSchema,
  type IdeaJobEvent,
} from "./schemas.ts"

export type { IdeaJobEvent } from "./schemas.ts"

async function writeEvents(
  output: { writeln(value: string): Promise<unknown> },
  events: AsyncIterable<IdeaJobEvent> | IdeaJobEvent[],
): Promise<void> {
  for await (const event of events) {
    await output.writeln(JSON.stringify(event))
  }
}

/** Registers durable idea-pipeline creation, history, detail, and events. */
export function ideaJobs(app: Hono, manager: IdeaJobManager) {
  app.post(
    "/idea-jobs",
    zValidator("json", createIdeaJobInputSchema),
    (c) => {
      const input = c.req.valid("json")
      const { ideaJobId, completion } = manager.start(input)
      void completion.catch((error: unknown) => {
        console.error(`Idea job ${ideaJobId} background task failed`, error)
      })

      c.header("Location", `/api/idea-jobs/${ideaJobId}`)
      return c.json({ ideaJobId }, 202)
    },
  )

  app.get(
    "/idea-jobs",
    zValidator("query", listIdeaJobsInputSchema),
    (c) => {
      const { limit } = c.req.valid("query")
      const jobs = db
        .select()
        .from(ideaJobsTable)
        .orderBy(desc(ideaJobsTable.createdAt))
        .limit(limit)
        .all()
      return c.json({ ideaJobs: jobs })
    },
  )

  app.get(
    "/idea-jobs/:ideaJobId/events",
    zValidator("param", ideaJobParamsSchema),
    (c) => {
      const { ideaJobId } = c.req.valid("param")
      const liveJob = manager.getLiveJob(ideaJobId)
      const persistedEvents = liveJob
        ? undefined
        : reconstructIdeaJobEvents(ideaJobId)
      if (!liveJob && !persistedEvents) {
        return c.json({ error: "Idea job not found" }, 404)
      }

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents!)
      })
    },
  )

  app.get(
    "/idea-jobs/:ideaJobId",
    zValidator("param", ideaJobParamsSchema),
    (c) => {
      const { ideaJobId } = c.req.valid("param")
      const job = db
        .select()
        .from(ideaJobsTable)
        .where(eq(ideaJobsTable.ideaJobId, ideaJobId))
        .get()
      if (!job) return c.json({ error: "Idea job not found" }, 404)
      return c.json({ ideaJob: job })
    },
  )
}
