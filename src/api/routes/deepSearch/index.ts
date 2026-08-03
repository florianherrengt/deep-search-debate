import { zValidator } from "@hono/zod-validator"
import { desc, eq, isNull } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import { deepSearchJobs as deepSearchJobsTable } from "../../db/schema/index.ts"
import {
  createDeepSearchJobManager,
  type DeepSearchJobManager,
} from "./manager.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import {
  createDeepSearchJobInputSchema,
  deepSearchJobParamsSchema,
  listDeepSearchJobsInputSchema,
  type DeepSearchJobEvent,
} from "./schemas.ts"

export type { DeepSearchJobEvent } from "./schemas.ts"

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
export function deepSearchJobs(
  app: Hono,
  manager: DeepSearchJobManager = createDeepSearchJobManager(),
) {

  app.post(
    "/deep-search-jobs",
    zValidator("json", createDeepSearchJobInputSchema),
    (c) => {
      const input = c.req.valid("json")
      const { deepSearchJobId, completion } = manager.start(input)
      void completion.catch(() => {})

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
        .where(isNull(deepSearchJobsTable.ideaJobId))
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
      const liveJob = manager.getLiveJob(deepSearchJobId)
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
