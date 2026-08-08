import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm"
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
import type { AppEnv } from "../../types/auth.ts"
import { deepSearchJobReadScope } from "../readAccess.ts"

export type { DeepSearchJobEvent } from "./schemas.ts"

const { userId: _deepSearchJobOwnerId, ...publicDeepSearchJobColumns } =
  getTableColumns(deepSearchJobsTable)
void _deepSearchJobOwnerId

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

/** Registers deep-search reads inherited from a public debate aggregate. */
export function deepSearchJobReads(
  app: Hono<AppEnv>,
  manager: DeepSearchJobManager = createDeepSearchJobManager(),
) {
  app.get(
    "/deep-search-jobs/:deepSearchJobId/events",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { deepSearchJobId } = c.req.valid("param")
      const persistedEvents = reconstructDeepSearchJobEvents(
        deepSearchJobId,
        deepSearchJobReadScope(c.get("viewerUserId")),
      )
      if (!persistedEvents) {
        return c.json({ error: "Deep search job not found" }, 404)
      }
      const liveJob = manager.getLiveJob(deepSearchJobId)

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents)
      })
    },
  )

  app.get(
    "/deep-search-jobs/:deepSearchJobId",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { deepSearchJobId } = c.req.valid("param")
      const deepSearchJob = db
        .select(publicDeepSearchJobColumns)
        .from(deepSearchJobsTable)
        .where(
          and(
            eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId),
            deepSearchJobReadScope(c.get("viewerUserId")),
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

/** Registers authenticated standalone search creation and readable history. */
export function deepSearchJobs(
  app: Hono<AppEnv>,
  manager: DeepSearchJobManager = createDeepSearchJobManager(),
) {
  app.post(
    "/deep-search-jobs",
    zValidator("json", createDeepSearchJobInputSchema),
    (c) => {
      const input = c.req.valid("json")
      const { deepSearchJobId, completion } = manager.start(
        c.get("userId"),
        input,
      )
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
        .select(publicDeepSearchJobColumns)
        .from(deepSearchJobsTable)
        .where(
          and(
            deepSearchJobReadScope(c.get("userId")),
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
}
