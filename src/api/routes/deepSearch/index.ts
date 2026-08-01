import { randomUUID } from "node:crypto"
import { zValidator } from "@hono/zod-validator"
import { desc, eq } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import { deepSearchJobs as deepSearchJobsTable } from "../../db/schema.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import { runDeepSearchJob } from "./run.ts"
import {
  createDeepSearchJobInputSchema,
  deepSearchJobParamsSchema,
  listDeepSearchJobsInputSchema,
  type DeepSearchJobEvent,
  type LiveDeepSearchJob,
} from "./schemas.ts"

export type { DeepSearchJobEvent } from "./schemas.ts"

/** Inserts a durable job before starting its retained background event log. */
function createDeepSearchJob(
  liveJobs: Map<string, LiveDeepSearchJob>,
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
): string {
  const deepSearchJobId = randomUUID()
  const job = createReplayableEventLog<DeepSearchJobEvent>()

  db.insert(deepSearchJobsTable)
    .values({
      deepSearchJobId,
      researchRequest,
      maxSearches,
      maxResultsPerSearch,
    })
    .run()
  liveJobs.set(deepSearchJobId, job)
  void runDeepSearchJob(
    deepSearchJobId,
    job,
    researchRequest,
    maxSearches,
    maxResultsPerSearch,
  ).catch((error: unknown) => {
    console.error(
      `Deep-search job ${deepSearchJobId} background task failed`,
      error,
    )
  })

  return deepSearchJobId
}

type EventOutput = {
  writeln(value: string): Promise<unknown>
}

async function writeEvents(
  output: EventOutput,
  events: AsyncIterable<DeepSearchJobEvent> | DeepSearchJobEvent[],
): Promise<void> {
  for await (const event of events) {
    await output.writeln(JSON.stringify(event))
  }
}

/** Registers creation, history, detail, and replay-and-follow endpoints. */
export function deepSearchJobs(app: Hono) {
  const liveJobs = new Map<string, LiveDeepSearchJob>()

  app.post(
    "/deep-search-jobs",
    zValidator("json", createDeepSearchJobInputSchema),
    (c) => {
      const input = c.req.valid("json")
      const deepSearchJobId = createDeepSearchJob(
        liveJobs,
        input.researchRequest,
        input.maxSearches,
        input.maxResultsPerSearch,
      )

      c.header("Location", `/api/deep-search-jobs/${deepSearchJobId}`)
      return c.json({ deepSearchJobId }, 202)
    },
  )

  app.get(
    "/deep-search-jobs",
    zValidator("query", listDeepSearchJobsInputSchema),
    (c) => {
      const input = c.req.valid("query")
      const deepSearchJobs = db
        .select()
        .from(deepSearchJobsTable)
        .orderBy(desc(deepSearchJobsTable.createdAt))
        .limit(input.limit)
        .all()
      return c.json({ deepSearchJobs })
    },
  )

  app.get(
    "/deep-search-jobs/:deepSearchJobId/events",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { deepSearchJobId } = c.req.valid("param")
      const liveJob = liveJobs.get(deepSearchJobId)
      const persistedEvents = liveJob
        ? undefined
        : reconstructDeepSearchJobEvents(deepSearchJobId)

      if (!liveJob && !persistedEvents) {
        return c.json({ error: "Deep search job not found" }, 404)
      }

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents!)
      })
    },
  )

  app.get(
    "/deep-search-jobs/:deepSearchJobId",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { deepSearchJobId } = c.req.valid("param")
      const deepSearchJob = db
        .select()
        .from(deepSearchJobsTable)
        .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
        .get()
      if (!deepSearchJob) {
        return c.json({ error: "Deep search job not found" }, 404)
      }
      return c.json({ deepSearchJob })
    },
  )
}
