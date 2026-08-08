import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, isNull } from "drizzle-orm"
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
  deepSearchJobEventParamsSchema,
  deepSearchJobParamsSchema,
  listDeepSearchJobsInputSchema,
  type DeepSearchJobEvent,
} from "./schemas.ts"
import type { AppEnv } from "../../types/auth.ts"

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
  app: Hono<AppEnv>,
  manager: DeepSearchJobManager = createDeepSearchJobManager(),
) {

  app.post(
    "/deep-search-jobs",
    zValidator("json", createDeepSearchJobInputSchema),
    async (c) => {
      const input = c.req.valid("json")
      const { deepSearchJobId, slug, completion } = await manager.start(
        c.get("userId"),
        input,
      )
      void completion.catch(() => {})

      c.header("Location", `/api/deep-search-jobs/${slug}`)
      return c.json({ deepSearchJobId, slug }, 202)
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
        .where(
          and(
            eq(deepSearchJobsTable.userId, c.get("userId")),
            isNull(deepSearchJobsTable.ideaJobId),
          ),
        )
        .orderBy(
          desc(deepSearchJobsTable.createdAt),
          desc(deepSearchJobsTable.deepSearchJobId),
        )
        .limit(input.limit)
        .all()
      return c.json({ deepSearchJobs })
    },
  )

  app.get(
    "/deep-search-jobs/:deepSearchJobId/events",
    zValidator("param", deepSearchJobEventParamsSchema),
    (c) => {
      const { deepSearchJobId } = c.req.valid("param")
      const ownedJob = db
        .select({ id: deepSearchJobsTable.deepSearchJobId })
        .from(deepSearchJobsTable)
        .where(
          and(
            eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId),
            eq(deepSearchJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!ownedJob) {
        return c.json({ error: "Deep search job not found" }, 404)
      }
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
    "/deep-search-jobs/:slug",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { slug } = c.req.valid("param")
      const deepSearchJob = db
        .select()
        .from(deepSearchJobsTable)
        .where(
          and(
            eq(deepSearchJobsTable.slug, slug),
            eq(deepSearchJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!deepSearchJob) {
        return c.json({ error: "Deep search job not found" }, 404)
      }
      return c.json({ deepSearchJob })
    },
  )
}
