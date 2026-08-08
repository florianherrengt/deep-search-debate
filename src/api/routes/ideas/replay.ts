import { and, asc, eq, type SQL } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
} from "../../db/schema/index.ts"
import type { IdeaJobEvent } from "./schemas.ts"

function replayNormalizedIdeas(ideaJobId: string): IdeaJobEvent[] {
  return db
    .select({ title: ideas.title, description: ideas.description })
    .from(ideas)
    .where(eq(ideas.ideaJobId, ideaJobId))
    .orderBy(asc(ideas.position))
    .all()
    .map((idea) => ({ type: "idea", ...idea }))
}

/** Reconstructs parent progress; nested deep-search details replay independently. */
export function reconstructIdeaJobEvents(
  ideaJobId: string,
  readScope?: SQL,
): IdeaJobEvent[] | undefined {
  const job = db
    .select()
    .from(ideaJobs)
    .where(and(eq(ideaJobs.ideaJobId, ideaJobId), readScope))
    .get()
  if (!job) return

  // The parent stores no duplicated child progress. It only re-emits the child
  // IDs; each nested deep-search subscription reconstructs its detailed events.
  const searches = db
    .select({
      deepSearchJobId: deepSearchJobs.deepSearchJobId,
      researchRequest: deepSearchJobs.researchRequest,
    })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
    .orderBy(asc(deepSearchJobs.ideaJobPosition))
    .all()

  return [
    ...(job.researchPromptGenerationId
      ? [
          {
            type: "research-prompt-stream" as const,
            streamId: job.researchPromptGenerationId,
          },
        ]
      : []),
    ...searches.map((search) => ({
      type: "deep-search-started" as const,
      ...search,
    })),
    ...(job.researchSummaryGenerationId
      ? [
          {
            type: "research-summary-stream" as const,
            streamId: job.researchSummaryGenerationId,
          },
        ]
      : []),
    ...(job.ideaGenerationId
      ? [
          {
            type: "idea-generation-stream" as const,
            streamId: job.ideaGenerationId,
          },
        ]
      : []),
    ...replayNormalizedIdeas(ideaJobId),
    ...(job.status === "running"
      ? []
      : [
          ...(job.error
            ? [
                {
                  type: "error" as const,
                  message: job.error,
                  stage: job.stage,
                },
              ]
            : []),
          { type: "done" as const },
        ]),
  ]
}
