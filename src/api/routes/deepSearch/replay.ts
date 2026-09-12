import { and, asc, eq, inArray, type SQL } from "drizzle-orm"
import { pageLinkSelectionSchema, parseResearchAnalysisText, parseResearchPlan } from "../../agents/deep_search/schemas.ts"
import { roundReviewSchema } from "../../agents/deep_search/reviewRound.ts"
import { secureJsonParse } from "../../helpers/secureJsonParse.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs as deepSearchJobsTable,
  deepSearchPageLinks,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchResults,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import type { DeepSearchJobEvent } from "./schemas.ts"
import {
  resolveEffectiveResearchRoot,
  stopRequestAppliesToJob,
} from "../researchCancellation.ts"

/** Reconstructs reducer-compatible progress from normalized typed rows. */
export function reconstructDeepSearchJobEvents(
  deepSearchJobId: string,
  readScope?: SQL,
): DeepSearchJobEvent[] | undefined {
  const job = db
    .select()
    .from(deepSearchJobsTable)
    .where(
      and(
        eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId),
        readScope,
      ),
    )
    .get()
  if (!job) return
  const effectiveRoot = db.transaction((transaction) =>
    resolveEffectiveResearchRoot(transaction, {
      kind: "deep-search",
      jobId: deepSearchJobId,
    }),
  )
  const stopRequested = stopRequestAppliesToJob({
    status: job.status,
    completedAt: job.completedAt,
    cancelRequestedAt: effectiveRoot?.cancelRequestedAt ?? null,
  })

  const rounds = db
    .select()
    .from(deepSearchRounds)
    .where(eq(deepSearchRounds.deepSearchJobId, deepSearchJobId))
    .orderBy(asc(deepSearchRounds.position))
    .all()

  const roundGenerationIds = rounds.flatMap((round) => [
    round.llmGenerationId,
    ...(round.reviewGenerationId ? [round.reviewGenerationId] : []),
  ])
  const completedRoundGenerations = new Map(roundGenerationIds.length === 0 ? [] : db
    .select({ id: llmGenerations.llmGenerationId, text: llmGenerations.text })
    .from(llmGenerations)
    .where(and(inArray(llmGenerations.llmGenerationId, roundGenerationIds), eq(llmGenerations.status, "completed")))
    .all().map(({ id, text }) => [id, text]))

  const queryRows = db
    .select({
      deepSearchQueryId: deepSearchQueries.deepSearchQueryId,
      query: deepSearchQueries.query,
      round: deepSearchRounds.position,
      position: deepSearchQueries.position,
      status: deepSearchQueries.status,
      errorStage: deepSearchQueries.errorStage,
      selectionGenerationId: deepSearchQueries.selectionGenerationId,
      summaryGenerationId: deepSearchQueries.summaryGenerationId,
    })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(eq(deepSearchRounds.deepSearchJobId, deepSearchJobId))
    .orderBy(
      asc(deepSearchRounds.position),
      asc(deepSearchQueries.position),
    )
    .all()

  const resultsByQuery = new Map<
    string,
    (typeof deepSearchResults.$inferSelect)[]
  >(
    queryRows.map((query) => [query.deepSearchQueryId, []]),
  )
  if (queryRows.length > 0) {
    const results = db
      .select()
      .from(deepSearchResults)
      .where(
        inArray(
          deepSearchResults.deepSearchQueryId,
          queryRows.map(({ deepSearchQueryId }) => deepSearchQueryId),
        ),
      )
      .orderBy(
        asc(deepSearchResults.deepSearchQueryId),
        asc(deepSearchResults.position),
      )
      .all()
    for (const result of results) {
      resultsByQuery.get(result.deepSearchQueryId)?.push(result)
    }
  }

  const planningAndSelectionEvents = rounds.flatMap<DeepSearchJobEvent>(
    (round) => {
      const queries = queryRows.filter(
        (query) => query.round === round.position,
      )
      const queryProgressEvents = queries.flatMap<DeepSearchJobEvent>(
        (query) => {
          const results = resultsByQuery.get(query.deepSearchQueryId) ?? []
          const selectionEvents: DeepSearchJobEvent[] =
            query.selectionGenerationId
              ? [
                  {
                    type: "selection-stream",
                    round: round.position,
                    query: query.query,
                    streamId: query.selectionGenerationId,
                  },
                ]
              : []
          const selectionCompleted =
            query.status === "summarizing" ||
            query.status === "completed" ||
            (query.status === "failed" && query.errorStage === "summary")
          const selectedResultsEvents: DeepSearchJobEvent[] =
            selectionCompleted
              ? [
                  {
                    type: "selected-search-results",
                    round: round.position,
                    query: query.query,
                    selectedLinks: results
                      .filter(
                        (result) => result.selectedWebPageId !== null,
                      )
                      .map((result) => result.url),
                  },
                ]
              : []
          return [...selectionEvents, ...selectedResultsEvents]
        },
      )
      const searchesCompleted =
        queries.length > 0 &&
        queries.every(
          (query) =>
            query.status !== "searching" &&
            !(query.status === "failed" && query.errorStage === "search"),
        )
      const searchResultEvents: DeepSearchJobEvent[] = searchesCompleted
        ? [
            {
              type: "search-results",
              round: round.position,
              searches: queries.map((query) => ({
                query: query.query,
                results: (
                  resultsByQuery.get(query.deepSearchQueryId) ?? []
                ).map((result) => ({
                  title: result.title,
                  shortText: result.shortText,
                  link: result.url,
                })),
              })),
            },
          ]
        : []

      return [
        {
          type: "query-stream",
          round: round.position,
          streamId: round.llmGenerationId,
        },
        ...searchResultEvents,
        ...queryProgressEvents,
      ]
    },
  )

  const pages = db
    .select()
    .from(deepSearchWebPages)
    .where(eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId))
    .orderBy(
      asc(deepSearchWebPages.createdAt),
      asc(deepSearchWebPages.deepSearchWebPageId),
    )
    .all()
  const pageEvents = pages.flatMap<DeepSearchJobEvent>((page) => {
    if (page.summaryGenerationId) {
      return [
        {
          type: "page-summary-stream",
          url: page.url,
          streamId: page.summaryGenerationId,
        },
      ]
    }
    if (page.errorStage && page.errorMessage) {
      return [
        {
          type: "page-summary-error",
          url: page.url,
          stage: page.errorStage,
          message: page.errorMessage,
        },
      ]
    }
    return []
  })

  const links = pages.length === 0 ? [] : db.select()
    .from(deepSearchPageLinks)
    .where(inArray(deepSearchPageLinks.sourceWebPageId, pages.map((page) => page.deepSearchWebPageId)))
    .orderBy(asc(deepSearchPageLinks.position)).all()
  const linksByPageId = Map.groupBy(links, ({ sourceWebPageId }) => sourceWebPageId)
  const selectorIds = pages.flatMap((page) => page.linkSelectionGenerationId ? [page.linkSelectionGenerationId] : [])
  const completedSelectors = new Map(selectorIds.length === 0 ? [] : db
    .select({ id: llmGenerations.llmGenerationId, text: llmGenerations.text }).from(llmGenerations)
    .where(and(inArray(llmGenerations.llmGenerationId, selectorIds), eq(llmGenerations.status, "completed")))
    .all().map(({ id, text }) => [id, text]))
  const linkedPageEvents = pages.flatMap<DeepSearchJobEvent>((page) => {
    if (!page.linkSelectionGenerationId) return []
    const output = completedSelectors.get(page.linkSelectionGenerationId)
    const sourceLinks = new Map((linksByPageId.get(page.deepSearchWebPageId) ?? [])
      .map((link) => [link.deepSearchPageLinkId, link]))
    return [
      { type: "linked-page-selection-stream", sourceUrl: page.url, streamId: page.linkSelectionGenerationId },
      ...(output !== undefined && output !== null ? [{
        type: "selected-linked-pages" as const,
        sourceUrl: page.url,
        links: pageLinkSelectionSchema.parse(secureJsonParse(output)).selectedIds.map((id) => {
          const link = sourceLinks.get(id)
          if (!link || link.selectedWebPageId === null) {
            throw new Error("Completed link selection is missing its selected page")
          }
          return { url: link.url, title: link.title }
        }),
      }] : []),
    ]
  })

  const summaryAndReviewEvents = rounds.flatMap<DeepSearchJobEvent>((round) => {
    const planningRequirementsEvents: DeepSearchJobEvent[] = []
    const reviewRequirementsEvents: DeepSearchJobEvent[] = []
    const planningText = completedRoundGenerations.get(round.llmGenerationId)
    if (planningText) {
      try {
        const plan = parseResearchPlan(planningText)
        if (plan.version === 1) {
          planningRequirementsEvents.push({ type: "research-requirements", round: round.position, requirements: plan.requirements })
        }
      } catch {
        // Legacy or manually edited generation text has no validated checklist.
      }
    }
    const reviewText = round.reviewGenerationId
      ? completedRoundGenerations.get(round.reviewGenerationId) : undefined
    if (reviewText && round.reviewDecision !== null) {
      try {
        const review = roundReviewSchema.parse(secureJsonParse(reviewText))
        if (review.requirements !== undefined) {
          reviewRequirementsEvents.push({ type: "research-requirements", round: round.position, requirements: review.requirements })
        }
      } catch {
        // The relational review outcome remains replayable without a checklist.
      }
    }
    const summaryEvents = queryRows.flatMap<DeepSearchJobEvent>((query) =>
      query.round === round.position && query.summaryGenerationId
        ? [
            {
              type: "query-summary-stream",
              round: round.position,
              query: query.query,
              streamId: query.summaryGenerationId,
            },
          ]
        : [],
    )
    const answerEvents: DeepSearchJobEvent[] = round.answerGenerationId
      ? [
          {
            type: "round-answer-stream",
            round: round.position,
            streamId: round.answerGenerationId,
          },
        ]
      : []
    const reviewStreamEvents: DeepSearchJobEvent[] = round.reviewGenerationId
      ? [
          {
            type: "round-review-stream",
            round: round.position,
            streamId: round.reviewGenerationId,
          },
        ]
      : []
    const reviewOutcomeEvents: DeepSearchJobEvent[] =
      round.reviewDecision && round.reviewReason
        ? [
            {
              type: "round-review",
              round: round.position,
              decision: round.reviewDecision,
              reason: round.reviewReason,
            },
          ]
        : round.reviewError
          ? [
              {
                type: "round-review-error",
                round: round.position,
                message: round.reviewError,
              },
            ]
          : []
    return [
      ...planningRequirementsEvents,
      ...summaryEvents,
      ...answerEvents,
      ...reviewStreamEvents,
      ...reviewOutcomeEvents,
      ...reviewRequirementsEvents,
    ]
  })

  const finalAnswerEvents: DeepSearchJobEvent[] = job.finalAnswerGenerationId
    ? [
        {
          type: "final-answer-stream",
          streamId: job.finalAnswerGenerationId,
        },
      ]
    : []
  const researchAnalysisGeneration =
    job.status === "completed" && job.researchAnalysisGenerationId
      ? db
          .select({
            status: llmGenerations.status,
            text: llmGenerations.text,
          })
          .from(llmGenerations)
          .where(
            eq(
              llmGenerations.llmGenerationId,
              job.researchAnalysisGenerationId,
            ),
          )
          .get()
      : undefined
  let researchAnalysisEvents: DeepSearchJobEvent[] = []
  if (
    researchAnalysisGeneration?.status === "completed" &&
    researchAnalysisGeneration.text !== null
  ) {
    try {
      researchAnalysisEvents = [
        {
          type: "research-analysis",
          analysis: parseResearchAnalysisText(
            researchAnalysisGeneration.text,
          ),
        },
      ]
    } catch {
      // Malformed legacy or manually edited structured output is omitted.
    }
  }
  const terminalEvents: DeepSearchJobEvent[] =
    job.status === "running"
      ? stopRequested
        ? [{ type: "stop-requested" }]
        : []
      : [
          ...(stopRequested ? [{ type: "stop-requested" as const }] : []),
          ...(job.status === "interrupted"
            ? [{ type: "interrupted" as const, message: job.error! }]
            : job.status === "failed"
              ? [{ type: "error" as const, message: job.error! }]
              : []),
          { type: "done" },
        ]

  return [
    ...planningAndSelectionEvents,
    ...linkedPageEvents,
    ...pageEvents,
    ...summaryAndReviewEvents,
    ...finalAnswerEvents,
    ...researchAnalysisEvents,
    ...terminalEvents,
  ]
}
