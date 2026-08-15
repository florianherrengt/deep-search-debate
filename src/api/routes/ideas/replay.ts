import { aliasedTable, and, asc, eq, lt, sql, type SQL } from "drizzle-orm"
import { secureJsonParse } from "@ai-sdk/provider-utils"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  ideaEvaluationSchema,
  type IdeaEvaluation,
  type IdeaJobEvent,
} from "./schemas.ts"
import {
  resolveEffectiveResearchRoot,
  stopRequestAppliesToJob,
} from "../researchCancellation.ts"

function parseIdeaEvaluation(text: string | null): IdeaEvaluation | undefined {
  if (text === null) return
  try {
    const evaluation = ideaEvaluationSchema.safeParse(
      secureJsonParse(text),
    )
    return evaluation.success ? evaluation.data : undefined
  } catch {
    return
  }
}

function replayNormalizedIdeas(ideaJobId: string, deepSearchCount: number): {
  ideaEvents: IdeaJobEvent[]
  evaluationEvents: IdeaJobEvent[]
  refinementEvents: IdeaJobEvent[]
  researchEvents: IdeaJobEvent[]
  hasIdeas: boolean
  allEvaluationsCompleted: boolean
  selectionResolved: boolean
  allRefinementsCompleted: boolean
  allSelectedResearchCompleted: boolean
  selectedIdeaIds: string[]
} {
  const evaluationGenerations = aliasedTable(
    llmGenerations,
    "idea_evaluation_generations",
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
      evaluationStatus: evaluationGenerations.status,
      evaluationText: evaluationGenerations.text,
      selected: ideas.selected,
      refinementGenerationId: ideas.refinementGenerationId,
      refinementStatus: refinementGenerations.status,
      refinedTitle: ideas.refinedTitle,
      refinedDescription: ideas.refinedDescription,
      deepSearchJobId: deepSearchJobs.deepSearchJobId,
      deepSearchStatus: deepSearchJobs.status,
      deepSearchTitle: deepSearchJobs.title,
      deepSearchSlug: deepSearchJobs.slug,
      deepSearchResearchRequest: deepSearchJobs.researchRequest,
    })
    .from(ideas)
    .leftJoin(
      evaluationGenerations,
      eq(
        ideas.evaluationGenerationId,
        evaluationGenerations.llmGenerationId,
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
  const evaluationReplays = selectedIdeas.map(
    (idea): { completed: boolean; events: IdeaJobEvent[] } => {
      const evaluation =
        idea.evaluationStatus === "completed"
          ? parseIdeaEvaluation(idea.evaluationText)
          : undefined
      return {
        completed: evaluation !== undefined,
        events: evaluation
          ? [
              {
                type: "idea-evaluated" as const,
                ideaId: idea.ideaId,
                ...evaluation,
              },
            ]
          : [],
      }
    },
  )

  return {
    ideaEvents: persistedIdeas.map(({ ideaId, title, description }) => ({
      type: "idea" as const,
      ideaId,
      title,
      description,
    })),
    evaluationEvents: evaluationReplays.flatMap(({ events }) => events),
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
    allEvaluationsCompleted:
      evaluationReplays.length > 0 &&
      evaluationReplays.every(({ completed }) => completed),
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
    allSelectedResearchCompleted:
      selectedIdeas.length > 0 &&
      selectedIdeas.every(
        ({ deepSearchStatus }) => deepSearchStatus === "completed",
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
  const effectiveRoot = db.transaction((transaction) =>
    resolveEffectiveResearchRoot(transaction, {
      kind: "idea",
      jobId: ideaJobId,
    }),
  )
  const stopRequested = stopRequestAppliesToJob({
    status: job.status,
    completedAt: job.completedAt,
    cancelRequestedAt: effectiveRoot?.cancelRequestedAt ?? null,
  })

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
    ...normalizedIdeas.evaluationEvents,
    ...(stopRequested ? [{ type: "stop-requested" as const }] : []),
    ...(job.status === "running"
      ? []
      : [
          ...(job.status === "interrupted"
            ? [
                {
                  type: "interrupted" as const,
                  message: job.error!,
                },
              ]
            : job.status === "failed"
            ? [
                {
                  type: "error" as const,
                  message: job.error!,
                  stage:
                    job.stage === "ideas" && normalizedIdeas.hasIdeas
                      ? !normalizedIdeas.selectionResolved
                          ? ("selection" as const)
                          : !normalizedIdeas.allRefinementsCompleted
                            ? ("refinement" as const)
                            : !normalizedIdeas.allSelectedResearchCompleted
                              ? ("idea-research" as const)
                              : !normalizedIdeas.allEvaluationsCompleted
                                ? ("evaluation" as const)
                                : ("idea-research" as const)
                      : job.stage,
                },
              ]
            : []),
          { type: "done" as const },
        ]),
  ]
}
