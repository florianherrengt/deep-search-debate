import { aliasedTable, and, asc, eq, lt, sql, type SQL } from "drizzle-orm"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import type { IdeaJobEvent } from "./schemas.ts"

function replayNormalizedIdeas(ideaJobId: string, deepSearchCount: number): {
  ideaEvents: IdeaJobEvent[]
  critiqueEvents: IdeaJobEvent[]
  refinementEvents: IdeaJobEvent[]
  researchEvents: IdeaJobEvent[]
  hasIdeas: boolean
  allCritiquesCompleted: boolean
  selectionResolved: boolean
  allRefinementsCompleted: boolean
  selectedIdeaIds: string[]
} {
  const critiqueGenerations = aliasedTable(
    llmGenerations,
    "idea_critique_generations",
  )
  const refinementGenerations = aliasedTable(
    llmGenerations,
    "idea_refinement_generations",
  )
  const persistedIdeas = db
    .select({
      ideaId: ideas.ideaId,
      title: ideas.title,
      description: ideas.description,
      position: ideas.position,
      critiqueGenerationId: ideas.critiqueGenerationId,
      critiqueStatus: critiqueGenerations.status,
      selected: ideas.selected,
      refinementGenerationId: ideas.refinementGenerationId,
      refinementStatus: refinementGenerations.status,
      refinedTitle: ideas.refinedTitle,
      refinedDescription: ideas.refinedDescription,
      deepSearchJobId: deepSearchJobs.deepSearchJobId,
      deepSearchTitle: deepSearchJobs.title,
      deepSearchSlug: deepSearchJobs.slug,
      deepSearchResearchRequest: deepSearchJobs.researchRequest,
    })
    .from(ideas)
    .leftJoin(
      critiqueGenerations,
      eq(
        ideas.critiqueGenerationId,
        critiqueGenerations.llmGenerationId,
      ),
    )
    .leftJoin(
      refinementGenerations,
      eq(
        ideas.refinementGenerationId,
        refinementGenerations.llmGenerationId,
      ),
    )
    .leftJoin(
      deepSearchJobs,
      and(
        eq(deepSearchJobs.ideaJobId, ideas.ideaJobId),
        sql`${deepSearchJobs.ideaJobPosition} = ${deepSearchCount} + ${ideas.position}`,
      ),
    )
    .where(eq(ideas.ideaJobId, ideaJobId))
    .orderBy(asc(ideas.position))
    .all()
  const selectedIdeaIds = persistedIdeas
    .filter(({ selected }) => selected === true)
    .map(({ ideaId }) => ideaId)
  const selectedIdeas = persistedIdeas.filter(
    ({ selected }) => selected === true,
  )

  return {
    ideaEvents: persistedIdeas.map(({ ideaId, title, description }) => ({
      type: "idea" as const,
      ideaId,
      title,
      description,
    })),
    critiqueEvents: persistedIdeas.flatMap(
      ({ critiqueGenerationId, position }) =>
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
    refinementEvents: selectedIdeas.flatMap(
      ({
        ideaId,
        refinementGenerationId,
        refinedTitle,
        refinedDescription,
      }) => [
        ...(refinementGenerationId
          ? [
              {
                type: "idea-refinement-stream" as const,
                ideaId,
                streamId: refinementGenerationId,
              },
            ]
          : []),
        ...(refinedTitle && refinedDescription
          ? [
              {
                type: "refined-idea" as const,
                ideaId,
                title: refinedTitle,
                description: refinedDescription,
              },
            ]
          : []),
      ],
    ),
    researchEvents: selectedIdeas.flatMap(
      ({
        ideaId,
        deepSearchJobId,
        deepSearchTitle,
        deepSearchSlug,
        deepSearchResearchRequest,
      }) =>
        deepSearchJobId &&
        deepSearchTitle &&
        deepSearchSlug &&
        deepSearchResearchRequest
          ? [
              {
                type: "idea-deep-search-started" as const,
                ideaId,
                deepSearchJobId,
                title: deepSearchTitle,
                slug: deepSearchSlug,
                researchRequest: deepSearchResearchRequest,
              },
            ]
          : [],
    ),
    hasIdeas: persistedIdeas.length > 0,
    allCritiquesCompleted:
      persistedIdeas.length > 0 &&
      persistedIdeas.every(({ critiqueStatus }) => critiqueStatus === "completed"),
    selectionResolved:
      persistedIdeas.length > 0 &&
      persistedIdeas.every(({ selected }) => selected !== null),
    allRefinementsCompleted:
      selectedIdeas.length > 0 &&
      selectedIdeas.every(
        ({ refinementStatus, refinedTitle, refinedDescription }) =>
          refinementStatus === "completed" &&
          Boolean(refinedTitle) &&
          Boolean(refinedDescription),
      ),
    selectedIdeaIds,
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
    .where(
      and(
        eq(deepSearchJobs.ideaJobId, ideaJobId),
        lt(deepSearchJobs.ideaJobPosition, job.deepSearchCount),
      ),
    )
    .orderBy(asc(deepSearchJobs.ideaJobPosition))
    .all()
  const normalizedIdeas = replayNormalizedIdeas(
    ideaJobId,
    job.deepSearchCount,
  )

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
    ...normalizedIdeas.ideaEvents,
    ...normalizedIdeas.critiqueEvents,
    ...(job.selectionGenerationId
      ? [
          {
            type: "idea-selection-stream" as const,
            streamId: job.selectionGenerationId,
          },
        ]
      : []),
    ...(normalizedIdeas.selectionResolved
      ? [
          {
            type: "selected-ideas" as const,
            selectedIdeaIds: normalizedIdeas.selectedIdeaIds,
          },
        ]
      : []),
    ...normalizedIdeas.refinementEvents,
    ...normalizedIdeas.researchEvents,
    ...(job.status === "running"
      ? []
      : [
          ...(job.error
            ? [
                {
                  type: "error" as const,
                  message: job.error,
                  stage:
                    job.stage === "ideas" && normalizedIdeas.hasIdeas
                      ? !normalizedIdeas.allCritiquesCompleted
                        ? ("critique" as const)
                        : !normalizedIdeas.selectionResolved
                          ? ("selection" as const)
                          : !normalizedIdeas.allRefinementsCompleted
                            ? ("refinement" as const)
                            : ("idea-research" as const)
                      : job.stage,
                },
              ]
            : []),
          { type: "done" as const },
        ]),
  ]
}
