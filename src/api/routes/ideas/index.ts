import { randomUUID } from "node:crypto"
import { zValidator } from "@hono/zod-validator"
import { desc, eq } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import { ideaJobs as ideaJobsTable } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import { runIdeaJob } from "./run.ts"
import {
  createIdeaJobInputSchema,
  ideaJobParamsSchema,
  listIdeaJobsInputSchema,
  type IdeaJobEvent,
  type LiveIdeaJob,
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

function hasDurableTerminalState(ideaJobId: string): boolean {
  try {
    const job = db
      .select({ status: ideaJobsTable.status })
      .from(ideaJobsTable)
      .where(eq(ideaJobsTable.ideaJobId, ideaJobId))
      .get()
    return job?.status !== undefined && job.status !== "running"
  } catch {
    // If the terminal row cannot be read, keep the closed log because it may
    // be the only available copy of the failure and done events.
    return false
  }
}

/** Registers durable idea-pipeline creation, history, detail, and events. */
export function ideaJobs(app: Hono, deepSearchManager: DeepSearchJobManager) {
  // Live logs support replay-and-follow for the current process. On restart the
  // events endpoint falls back to reconstructIdeaJobEvents and durable rows.
  const liveJobs = new Map<string, LiveIdeaJob>()

  app.post(
    "/idea-jobs",
    zValidator("json", createIdeaJobInputSchema),
    (c) => {
      const input = c.req.valid("json")
      const ideaJobId = randomUUID()
      const job = createReplayableEventLog<IdeaJobEvent>()

      db.insert(ideaJobsTable)
        .values({
          ideaJobId,
          prompt: input.prompt,
          numberOfIdeas: input.numberOfIdeas,
          deepSearchCount: input.deepSearchCount,
        })
        .run()

      // The parent row must exist before any asynchronous generation starts so
      // every emitted stream and child job can be linked durably.
      liveJobs.set(ideaJobId, job)
      void runIdeaJob({
        ideaJobId,
        ...input,
        job,
        deepSearchManager,
      })
        .catch((error: unknown) => {
          console.error(`Idea job ${ideaJobId} background task failed`, error)
        })
        .finally(() => {
          if (hasDurableTerminalState(ideaJobId)) {
            // Existing subscribers keep their iterator; later subscriptions
            // reconstruct the terminal run without retaining this closed log.
            liveJobs.delete(ideaJobId)
          }
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
      const liveJob = liveJobs.get(ideaJobId)
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
