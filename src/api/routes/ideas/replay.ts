import { and, asc, eq, type SQL } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
} from "../../db/schema/index.ts"
import type { IdeaJobEvent } from "./schemas.ts"

function replayNormalizedIdeas(ideaJobId: string): {
  events: IdeaJobEvent[]
  hasIdeas: boolean
} {
  const persistedIdeas = db
    .select({
      title: ideas.title,
      description: ideas.description,
      position: ideas.position,
      critiqueGenerationId: ideas.critiqueGenerationId,
    })
    .from(ideas)
    .where(eq(ideas.ideaJobId, ideaJobId))
    .orderBy(asc(ideas.position))
    .all()

  return {
    events: [
      ...persistedIdeas.map(({ title, description }) => ({
        type: "idea" as const,
        title,
        description,
      })),
      ...persistedIdeas.flatMap(({ critiqueGenerationId, position }) =>
        critiqueGenerationId
          ? [
              {
                type: "critique-generation-stream" as const,
                position,
                streamId: critiqueGenerationId,
              },
            ]
          : [],
      ),
    ],
    hasIdeas: persistedIdeas.length > 0,
  }
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
      title: deepSearchJobs.title,
      slug: deepSearchJobs.slug,
      researchRequest: deepSearchJobs.researchRequest,
    })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
    .orderBy(asc(deepSearchJobs.ideaJobPosition))
    .all()
  const normalizedIdeas = replayNormalizedIdeas(ideaJobId)

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
    ...normalizedIdeas.events,
    ...(job.status === "running"
      ? []
      : [
          ...(job.error
            ? [
                {
                  type: "error" as const,
                  message: job.error,
                  // Persisted ideas prove structured generation completed, so
                  // a terminal error in this durable stage occurred during the
                  // per-idea critique subphase.
                  stage:
                    job.stage === "ideas" && normalizedIdeas.hasIdeas
                      ? ("critique" as const)
                      : job.stage,
                },
              ]
            : []),
          { type: "done" as const },
        ]),
  ]
}
