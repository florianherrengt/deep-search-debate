import { zValidator } from "@hono/zod-validator"
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
} from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  deepSearchJobs as deepSearchJobsTable,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
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
  type DeepSearchJobSource,
} from "./schemas.ts"
import type { AppEnv } from "../../types/auth.ts"
import { deepSearchJobReadScope } from "../readAccess.ts"

export type { DeepSearchJobEvent } from "./schemas.ts"

const { userId: _deepSearchJobOwnerId, ...publicDeepSearchJobColumns } =
  getTableColumns(deepSearchJobsTable)

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
    zValidator("param", deepSearchJobEventParamsSchema),
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
    "/deep-search-jobs/:slug",
    zValidator("param", deepSearchJobParamsSchema),
    (c) => {
      const { slug } = c.req.valid("param")
      const deepSearchJob = db
        .select({
          ...publicDeepSearchJobColumns,
          debateStatus: debateJobsTable.status,
          isPublic: debateJobsTable.isPublic,
        })
        .from(deepSearchJobsTable)
        .leftJoin(
          ideaJobsTable,
          eq(ideaJobsTable.ideaJobId, deepSearchJobsTable.ideaJobId),
        )
        .leftJoin(
          debateJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(
          and(
            eq(deepSearchJobsTable.slug, slug),
            deepSearchJobReadScope(c.get("viewerUserId")),
          ),
        )
        .get()
      if (!deepSearchJob) {
        return c.json({ error: "Deep search job not found" }, 404)
      }
      const {
        debateStatus,
        isPublic: inheritedIsPublic,
        ...publicDeepSearchJob
      } = deepSearchJob
      const isPublic = inheritedIsPublic ?? false
      return c.json({
        deepSearchJob: {
          ...publicDeepSearchJob,
          isIndexable: isPublic && debateStatus === "completed",
          isPublic,
        },
      })
    },
  )
}

/** Newest-first jobs with their origin: null for manual searches, the
 * owning idea or debate for automated child searches. */
function listDeepSearchJobs(
  userId: string,
  source: DeepSearchJobSource,
  limit: number,
): Array<Record<string, unknown>> {
  const rows = db
    .select({
      job: publicDeepSearchJobColumns,
      idea: {
        title: ideaJobsTable.title,
        slug: ideaJobsTable.slug,
        debateJobId: ideaJobsTable.debateJobId,
      },
    })
    .from(deepSearchJobsTable)
    .leftJoin(
      ideaJobsTable,
      eq(deepSearchJobsTable.ideaJobId, ideaJobsTable.ideaJobId),
    )
    .where(
      and(
        eq(deepSearchJobsTable.userId, userId),
        source === "automated"
          ? isNotNull(deepSearchJobsTable.ideaJobId)
          : isNull(deepSearchJobsTable.ideaJobId),
      ),
    )
    .orderBy(
      desc(deepSearchJobsTable.createdAt),
      desc(deepSearchJobsTable.deepSearchJobId),
    )
    .limit(limit)
    .all()
  return rows.map(({ job, idea }) => ({
    ...job,
    origin: deepSearchJobOrigin(idea),
  }))
}

function deepSearchJobOrigin(
  idea: {
    title: string | null
    slug: string | null
    debateJobId: string | null
  } | null,
): { kind: "idea" | "debate"; title: string; slug: string } | null {
  if (!idea?.title || !idea.slug) {
    return null
  }
  // Debates carry no title of their own: the owning idea job's title and
  // slug address the debate route, so a debate-owned search points there.
  return {
    kind: idea.debateJobId ? "debate" : "idea",
    title: idea.title,
    slug: idea.slug,
  }
}

/** Registers authenticated standalone search creation and readable history. */
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
      const deepSearchJobs = listDeepSearchJobs(
        c.get("userId"),
        input.source,
        input.limit,
      )
      return c.json({ deepSearchJobs })
    },
  )
}
