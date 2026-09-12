import PQueue from "p-queue"
import { Effect, Result } from "effect"
import { answerResearchRequest } from "../../agents/deep_search/finalAnswer.ts"
import { generateWebSearchQueries } from "../../agents/deep_search/queries.ts"
import { summarizeSearchQuery } from "../../agents/deep_search/querySummaries.ts"
import { analyzeResearchAnswer } from "../../agents/deep_search/researchAnalysis.ts"
import {
  startRoundReview,
  roundReviewSchema,
  type RoundReview,
} from "../../agents/deep_search/reviewRound.ts"
import {
  researchAnalysisSchema,
  pageLinkSelectionSchema,
  parseResearchPlan,
  type ResearchRequirements,
  type DeepSearchEvent,
  type DeepSearchSearch,
} from "../../agents/deep_search/schemas.ts"
import { selectPageLinks, selectWebSearchResults } from "../../agents/deep_search/selection.ts"
import type { SourceEvidence } from "../../agents/deep_search/searchSummaryContext.ts"
import {
  startPageSummary,
  summarizePage,
} from "../../agents/deep_search/summaries.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { addAbortableQueueTask } from "../../helpers/addAbortableQueueTask.ts"
import { webSearch } from "../../web_search/index.ts"
import { config } from "../../config.ts"
import { secureJsonParse } from "../../helpers/secureJsonParse.ts"
import {
  runWorkflowEffect,
  WorkflowFailure,
  WorkflowInterruptedError,
} from "../../workflowRuntime.ts"
import { completeReviewedAnswer, promoteRoundAnswer } from "./jobLifecycle.ts"
import { db } from "../../db/index.ts"
import { getLinkedPageDepthBudget } from "./resourceLimits.ts"
import type {
  DeepSearchExecutionSnapshot,
  ExecutedQuery,
  PersistedGeneration,
  PlannedQuery,
  SearchRound,
  SelectedPage,
} from "./records.ts"
import {
  attachPageSummaryGeneration,
  attachFinalAnswerGeneration,
  attachPageLinkSelectionGeneration,
  attachQuerySummaryGeneration,
  attachRoundAnswerGeneration,
  attachRoundReviewGeneration,
  attachResearchAnalysisGeneration,
  completePageSummaryGeneration,
  completePageLinkSelection,
  completeEmptySearchQuery,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  interruptPageSummaryGeneration,
  interruptQuerySummaryGeneration,
  interruptRoundReviewGeneration,
  loadDeepSearchExecutionSnapshot,
  registerSearchRound,
  registerSelectionGeneration,
  replacePageSummaryGeneration,
  replaceFinalAnswerGeneration,
  replacePageLinkSelectionGeneration,
  replaceQuerySelectionGeneration,
  replaceQuerySummaryGeneration,
  replaceResearchAnalysisGeneration,
  replaceRoundAnswerGeneration,
  replaceRoundPlanningGeneration,
  replaceRoundReviewGeneration,
  resetWebSearchQuery,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveRoundReviewFailure,
  saveSelectedResults,
  settlePageExtraction,
  settleWebSearchQuery,
} from "./store.ts"

export type DeepSearchPipelineInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  maxSearches?: number
  maxResultsPerSearch?: number
  maxRounds?: number
  publish: (event: DeepSearchEvent) => void
  workflowSignal?: AbortSignal
}

const pageSummaryQueue = new PQueue({
  concurrency: config.deepSearch.maxConcurrentPageTasks,
})

const EMPTY_SEARCH_SUMMARY =
  "The web search returned no usable results for this query."

type SearchSummary = {
  round: number
  query: string
  content: string
}

type SnapshotRound = DeepSearchExecutionSnapshot["rounds"][number]
type SnapshotQuery = SnapshotRound["queries"][number]
type SnapshotPage = DeepSearchExecutionSnapshot["pages"][number]

const STALE_GENERATION_MESSAGE =
  "Interrupted generation replaced while resuming persisted research"

function loadSnapshot(jobId: string): DeepSearchExecutionSnapshot {
  const snapshot = loadDeepSearchExecutionSnapshot(jobId)
  if (!snapshot) throw new Error("Deep-search execution snapshot was not found")
  return snapshot
}

function parseStringArray(generation: PersistedGeneration): string[] {
  if (generation.status !== "completed" || generation.text === null) {
    throw new Error("Completed structured generation output was not persisted")
  }
  const parsed: unknown = JSON.parse(generation.text)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Persisted structured generation output is invalid")
  }
  return parsed
}

function completedText(generation: PersistedGeneration): string {
  if (generation.status !== "completed" || generation.text === null) {
    throw new Error("Completed generation text was not persisted")
  }
  return generation.text
}

function replacementInput(
  jobId: string,
  oldGeneration: PersistedGeneration,
  newGenerationId: string,
) {
  return {
    jobId,
    oldGenerationId: oldGeneration.generationId,
    newGenerationId,
    ...(oldGeneration.status === "running"
      ? { staleRunningMessage: STALE_GENERATION_MESSAGE }
      : {}),
  }
}

function toExecutedQuery(query: SnapshotQuery): ExecutedQuery {
  return {
    queryId: query.queryId,
    position: query.position,
    query: query.query,
    results: query.results.map(({ selectedWebPageId: _, ...result }) => result),
  }
}

function selectedPagesFromSnapshot(
  query: SnapshotQuery,
  pagesById: ReadonlyMap<string, SnapshotPage>,
): SelectedPage[] {
  return query.results.flatMap(({ selectedWebPageId }) => {
    if (selectedWebPageId === null) return []
    const page = pagesById.get(selectedWebPageId)
    if (!page) throw new Error("Selected web page was not persisted")
    return [{ pageId: page.pageId, url: page.url }]
  })
}

function toPublicSearch(search: ExecutedQuery): DeepSearchSearch {
  return {
    query: search.query,
    results: search.results.map((result) => ({
      title: result.title,
      shortText: result.shortText,
      link: result.url,
    })),
  }
}

function workflowEffect<Value>(
  run: () => Value | PromiseLike<Value>,
  fallback = "Deep-search work failed",
): Effect.Effect<Value, WorkflowFailure> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve().then(run),
      catch: (cause) =>
        cause instanceof WorkflowFailure
          ? cause
          : new WorkflowFailure({
              message: getErrorMessage(cause, fallback),
              cause,
            }),
    }),
  )
}

function settleAll<Value>(
  effects: readonly Effect.Effect<Value, WorkflowFailure>[],
): Effect.Effect<Value[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* Effect.all(effects, {
      concurrency: "unbounded",
      mode: "result",
    })
    // Result mode waits for every started effect and preserves input order.
    // Inspecting in that order keeps concurrent failure selection stable.
    const firstFailure = settled.find(Result.isFailure)
    if (firstFailure) yield* Effect.fail(firstFailure.failure)
    return settled.map((result) => {
      if (Result.isFailure(result)) throw result.failure
      return result.success
    })
  })
}

/** Source-level evidence survives a query summary omitting a URL or qualification. */
function sourceEvidenceFromSnapshot(snapshot: DeepSearchExecutionSnapshot): SourceEvidence[] {
  const descriptions = new Map<string, { title: string; snippet?: string }>()
  for (const round of snapshot.rounds) {
    for (const query of round.queries) {
      for (const result of query.results) {
        if (result.selectedWebPageId && !descriptions.has(result.selectedWebPageId)) {
          descriptions.set(result.selectedWebPageId, { title: result.title, snippet: result.shortText })
        }
      }
    }
  }
  for (const page of snapshot.pages) {
    for (const link of page.links) {
      if (link.selectedWebPageId && !descriptions.has(link.selectedWebPageId)) {
        descriptions.set(link.selectedWebPageId, { title: link.title })
      }
    }
  }
  return snapshot.pages.flatMap<SourceEvidence>((page) => {
    const description = descriptions.get(page.pageId)
    if (!description) return []
    const source = { url: page.url, title: description.title }
    if (page.status === "completed" && page.summaryGeneration?.status === "completed") {
      return [{ ...source, evidenceType: "page-summary", content: completedText(page.summaryGeneration),
        ...(page.originalPassages ? { originalPassages: page.originalPassages } : {}),
      }]
    }
    if (page.status !== "failed") return []
    if (description.snippet) {
      return [{ ...source, evidenceType: "search-snippet", content: description.snippet }]
    }
    return [{
      ...source,
      evidenceType: "unavailable",
      content: "This linked source could not be read or summarized. Its link title is a discovery lead, not evidence from the destination. No conclusion about its contents is supported.",
    }]
  })
}

function requirementsFromSnapshot(snapshot: DeepSearchExecutionSnapshot, throughRound: number): ResearchRequirements {
  for (const round of snapshot.rounds.toReversed()) {
    if (round.position > throughRound) continue
    if (round.reviewGeneration?.status === "completed") {
      const review = roundReviewSchema.parse(secureJsonParse(completedText(round.reviewGeneration)))
      if (review.requirements) return review.requirements
    }
    if (round.planningGeneration.status === "completed") {
      const text = completedText(round.planningGeneration)
      const plan = parseResearchPlan(text)
      if (plan.version === 1) return plan.requirements
    }
  }
  return []
}

/** Follow a bounded breadth-first frontier using the same durable page lifecycle. */
function exploreLinkedPages(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  roots: SelectedPage[],
  pageSummaries: Map<string, string | undefined>,
  strictQuality: boolean,
  maxSearches: number,
  maxResultsPerSearch: number,
): Effect.Effect<void, WorkflowFailure> {
  return Effect.gen(function*() {
    let frontier = roots
    const visitedSources = new Set<string>()
    for (let depth = 0; depth < config.deepSearch.maxLinkDepth; depth += 1) {
      const maximumLinkedPages = getLinkedPageDepthBudget({ maxSearches, maxResultsPerSearch }, depth)
      const nextPages = new Map<string, SelectedPage>()
      for (const source of frontier) {
        if (visitedSources.has(source.pageId)) continue
        visitedSources.add(source.pageId)
        let snapshot = yield* workflowEffect(() => loadSnapshot(params.deepSearchJobId))
        let page = snapshot.pages.find(({ pageId }) => pageId === source.pageId)
        if (!page) throw new WorkflowFailure({ message: "Linked-page source was not persisted" })
        if (page.links.length === 0) continue

        if (page.linkSelectionGeneration?.status !== "completed") {
          const selectedThisRound = new Set(snapshot.pages.flatMap((item) =>
            item.links.flatMap((link) =>
              link.selectedRoundId === round.roundId && link.selectedWebPageId
                ? [link.selectedWebPageId] : [],
            ),
          ))
          const remaining = maximumLinkedPages - selectedThisRound.size
          if (remaining <= 0) continue
          const knownUrls = new Set(snapshot.pages.map(({ url }) => url))
          const candidates = page.links.filter(({ url }) => !knownUrls.has(url))
          if (candidates.length === 0) continue
          const knownEvidence = new Map(sourceEvidenceFromSnapshot(snapshot).map((evidence) => [evidence.url, evidence]))
          const previousGeneration = page.linkSelectionGeneration
          const generation = yield* workflowEffect(() => selectPageLinks({
            userId: params.userId,
            deepSearchJobId: params.deepSearchJobId,
            userQuery: params.researchRequest,
            sourceUrl: source.url,
            sourceSummary: pageSummaries.get(source.url) ?? "No source summary is available.",
            knownPages: snapshot.pages.map(({ url, status }) => {
              const evidence = knownEvidence.get(url)
              return {
                url,
                status,
                ...(evidence ? { title: evidence.title } : {}),
                ...(evidence?.evidenceType === "page-summary" ? { summary: evidence.content } : {}),
              }
            }),
            requirements: requirementsFromSnapshot(snapshot, round.position),
            links: candidates.map(({ linkId, url, title }) => ({ id: linkId, url, title })),
            maxResultsToExplore: Math.min(remaining, maxResultsPerSearch),
            workflowSignal: params.workflowSignal,
            onRegistered: (generationId, transaction) => {
              if (previousGeneration) {
                replacePageLinkSelectionGeneration(transaction, {
                  ...replacementInput(params.deepSearchJobId, previousGeneration, generationId),
                  pageId: source.pageId,
                })
              } else {
                attachPageLinkSelectionGeneration(transaction, {
                  jobId: params.deepSearchJobId, pageId: source.pageId, generationId,
                })
              }
            },
            onCompleted: (completed, transaction) => {
              completePageLinkSelection(transaction, {
                jobId: params.deepSearchJobId,
                sourcePageId: source.pageId,
                roundId: round.roundId,
                generationId: completed.id,
                selectedLinkIds: completed.output,
              })
            },
          }))
          yield* workflowEffect(async () => {
            try {
              params.publish({ type: "linked-page-selection-stream", sourceUrl: source.url, streamId: generation.streamId })
            } catch (error) {
              await generation.selectedIds.catch(() => undefined)
              throw error
            }
            await generation.selectedIds
          })
          snapshot = yield* workflowEffect(() => loadSnapshot(params.deepSearchJobId))
          page = snapshot.pages.find(({ pageId }) => pageId === source.pageId)
          if (!page) throw new WorkflowFailure({ message: "Linked-page source was not persisted" })
        }

        if (page.linkSelectionGeneration?.status !== "completed") {
          throw new WorkflowFailure({ message: "Linked-page selection did not complete" })
        }
        const selectedIds = pageLinkSelectionSchema.parse(
          secureJsonParse(completedText(page.linkSelectionGeneration)),
        ).selectedIds
        const linksById = new Map(page.links.map((link) => [link.linkId, link]))
        const selectedLinks = selectedIds.map((id) => {
          const link = linksById.get(id)
          if (!link?.selectedWebPageId) {
            throw new WorkflowFailure({ message: "Completed link selection has no selected target" })
          }
          return link
        })
        yield* workflowEffect(() => params.publish({
          type: "selected-linked-pages",
          sourceUrl: source.url,
          links: selectedLinks.map(({ url, title }) => ({ url, title })),
        }))
        for (const link of selectedLinks) {
          const selected = snapshot.pages.find(({ pageId }) => pageId === link.selectedWebPageId)
          if (!selected) throw new WorkflowFailure({ message: "Selected linked page was not persisted" })
          nextPages.set(selected.pageId, { pageId: selected.pageId, url: selected.url })
        }
      }

      const snapshot = yield* workflowEffect(() => loadSnapshot(params.deepSearchJobId))
      const pagesById = new Map(snapshot.pages.map((page) => [page.pageId, page]))
      const summaries = yield* settleAll([...nextPages.values()].map((page) =>
        workflowEffect(async () => {
          const stored = pagesById.get(page.pageId)
          if (!stored) throw new Error("Selected linked page was not persisted")
          const summary = await addAbortableQueueTask(
            pageSummaryQueue,
            () => summarizeSelectedPage(params, stored, strictQuality),
            params.workflowSignal,
          )
          return [page.url, summary] as const
        }),
      ))
      for (const [url, summary] of summaries) pageSummaries.set(url, summary)
      frontier = [...nextPages.values()]
      if (frontier.length === 0) break
    }
  })
}

async function summarizeSelectedPage(
  params: DeepSearchPipelineInput,
  page: SnapshotPage,
  strictQuality: boolean,
): Promise<string | undefined> {
  if (
    page.status === "completed" &&
    page.summaryGeneration?.status === "completed"
  ) {
    return completedText(page.summaryGeneration).trim() || undefined
  }
  if (page.status === "failed" && page.errorStage === "extraction") return
  if (
    page.status === "failed" &&
    page.errorStage === "summary" &&
    !strictQuality
  ) {
    return
  }

  const previousGeneration = page.summaryGeneration
  const callbacks = {
    onRegistered: (generationId, transaction) => {
      if (previousGeneration) {
        replacePageSummaryGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousGeneration,
            generationId,
          ),
          pageId: page.pageId,
        })
      } else {
        attachPageSummaryGeneration(transaction, {
          jobId: params.deepSearchJobId,
          pageId: page.pageId,
          generationId,
        })
      }
    },
    onCompleted: (completed, transaction) => {
      completePageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: completed.id,
      })
    },
    onFailed: (failed, transaction) => {
      failPageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: failed.id,
        message: failed.error,
      })
    },
    onInterrupted: (interrupted, transaction) => {
      interruptPageSummaryGeneration(transaction, {
        jobId: params.deepSearchJobId,
        pageId: page.pageId,
        generationId: interrupted.id,
        message: interrupted.error,
      })
    },
  } satisfies Pick<
    Parameters<typeof startPageSummary>[0],
    "onRegistered" | "onCompleted" | "onFailed" | "onInterrupted"
  >

  const pageSummary = page.extractedContent === null
    ? await startPageSummary({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        researchRequest: params.researchRequest,
        url: page.url,
        workflowSignal: params.workflowSignal,
        onExtractionSettled: ({ content, creditsUsed, links }) => {
          settlePageExtraction({
            userId: params.userId,
            jobId: params.deepSearchJobId,
            pageId: page.pageId,
            content,
            creditsUsed,
            links,
          })
        },
        ...callbacks,
      })
    : await summarizePage({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        researchRequest: params.researchRequest,
        url: page.url,
        content: page.extractedContent,
        workflowSignal: params.workflowSignal,
        ...callbacks,
      }).then((generation) => ({
        status: "started" as const,
        streamId: generation.streamId,
        completion: generation.completion,
        summary: generation.completion.then((outcome) =>
          outcome.status === "completed"
            ? outcome.text.trim() || undefined
            : undefined,
        ),
      }))
  if (pageSummary.status === "failed") {
    savePageFailure({
      jobId: params.deepSearchJobId,
      pageId: page.pageId,
      stage: pageSummary.stage,
      message: pageSummary.message,
    })
    params.publish({
      type: "page-summary-error",
      url: page.url,
      stage: pageSummary.stage,
      message: pageSummary.message,
    })
    if (strictQuality && pageSummary.stage === "summary") {
      throw new Error(pageSummary.message)
    }
    return
  }

  try {
    params.publish({
      type: "page-summary-stream",
      url: page.url,
      streamId: pageSummary.streamId,
    })
  } catch (error) {
    await pageSummary.summary.catch(() => undefined)
    throw error
  }
  const summary = await pageSummary.summary
  const outcome = await pageSummary.completion
  if (outcome.status !== "completed") {
    params.publish({
      type: "page-summary-error",
      url: page.url,
      stage: "summary",
      message: outcome.error,
    })
    if (strictQuality) throw new Error(outcome.error)
  }
  return summary
}

function persistRoundReviewFailure(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  generationId: string,
  error: unknown,
): void {
  const message = getErrorMessage(error, "Round review failed")
  saveRoundReviewFailure({
    jobId: params.deepSearchJobId,
    roundId: round.roundId,
    generationId,
    message,
  })
  params.publish({
    type: "round-review-error",
    round: round.position,
    message,
  })
}

async function reviewSearchRound(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  maxRounds: number,
  searchSummaries: readonly SearchSummary[],
  candidateAnswer: string,
  previousGeneration?: PersistedGeneration,
): Promise<RoundReview | undefined> {
  let startedGenerationId: string | undefined
  const startedReview = await startRoundReview({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    candidateAnswer,
    completedRound: round.position,
    maxRounds,
    searchSummaries: [...searchSummaries],
    sourceEvidence: sourceEvidenceFromSnapshot(loadSnapshot(params.deepSearchJobId)),
    requirements: requirementsFromSnapshot(loadSnapshot(params.deepSearchJobId), round.position),
    workflowSignal: params.workflowSignal,
    onCompleted: (completed, transaction) => {
      saveRoundReviewCompletion(transaction, {
        jobId: params.deepSearchJobId,
        roundId: round.roundId,
        generationId: completed.id,
        review: completed.output,
      })
    },
    onRegistered: (streamId, transaction) => {
      startedGenerationId = streamId
      if (previousGeneration) {
        replaceRoundReviewGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousGeneration,
            streamId,
          ),
          roundId: round.roundId,
        })
      } else {
        attachRoundReviewGeneration(transaction, {
          jobId: params.deepSearchJobId,
          roundId: round.roundId,
          generationId: streamId,
        })
      }
    },
    onInterrupted: (interrupted, transaction) => {
      interruptRoundReviewGeneration(transaction, {
        jobId: params.deepSearchJobId,
        roundId: round.roundId,
        generationId: interrupted.id,
        message: interrupted.error,
      })
    },
  }).catch((error: unknown) => {
    if (error instanceof WorkflowInterruptedError) throw error
    if (!startedGenerationId) throw error
    persistRoundReviewFailure(params, round, startedGenerationId, error)
    return undefined
  })
  if (!startedReview) return undefined

  try {
    params.publish({
      type: "round-review-stream",
      round: round.position,
      streamId: startedReview.streamId,
    })
  } catch (error) {
    await startedReview.review.catch(() => undefined)
    throw error
  }

  return startedReview.review.catch((error: unknown) => {
    persistRoundReviewFailure(params, round, startedReview.streamId, error)
    return undefined
  })
}

async function promoteCandidateAnswer(
  params: DeepSearchPipelineInput,
  round: SearchRound,
  generationId: string,
  candidateAnswer: string,
  searchSummaries: readonly SearchSummary[],
): Promise<string> {
  const snapshot = loadSnapshot(params.deepSearchJobId)
  const previousAnalysis = snapshot.researchAnalysisGeneration
  const previousFinal = snapshot.finalAnswerGeneration
  if (previousAnalysis?.status === "completed" && !previousFinal) {
    // A pre-upgrade completed audit belongs to its original candidate. Keep
    // that completed checkpoint instead of silently pairing it with new text.
    const analysis = researchAnalysisSchema.parse(secureJsonParse(completedText(previousAnalysis)))
    promoteRoundAnswer({ jobId: params.deepSearchJobId, roundId: round.roundId,
      generationId, researchAnalysisGenerationId: previousAnalysis.generationId })
    params.publish({ type: "final-answer-stream", streamId: generationId })
    params.publish({ type: "research-analysis", analysis })
    return candidateAnswer
  }
  const sourceEvidence = sourceEvidenceFromSnapshot(snapshot)
  const requirements = requirementsFromSnapshot(snapshot, round.position)
  let finalGenerationId: string
  let finalAnswer: string
  if (previousFinal?.status === "completed") {
    finalGenerationId = previousFinal.generationId
    finalAnswer = completedText(previousFinal)
    params.publish({ type: "final-answer-stream", streamId: finalGenerationId })
  } else {
    const correction = await answerResearchRequest({
      userId: params.userId, deepSearchJobId: params.deepSearchJobId,
      researchRequest: params.researchRequest, candidateAnswer,
      reviewReason: snapshot.rounds.find(({ roundId }) => roundId === round.roundId)?.reviewReason ?? undefined,
      searchSummaries: [...searchSummaries], sourceEvidence, requirements,
      workflowSignal: params.workflowSignal,
      onRegistered: (id, transaction) => {
        if (previousFinal) {
          replaceFinalAnswerGeneration(transaction, replacementInput(params.deepSearchJobId, previousFinal, id))
        } else {
          attachFinalAnswerGeneration(transaction, { jobId: params.deepSearchJobId, generationId: id })
        }
      },
    })
    finalGenerationId = correction.streamId
    try {
      params.publish({ type: "final-answer-stream", streamId: finalGenerationId })
    } catch (error) {
      await correction.answer.catch(() => undefined)
      throw error
    }
    finalAnswer = await correction.answer
  }
  if (previousAnalysis?.status === "completed") {
    const analysis = researchAnalysisSchema.parse(secureJsonParse(completedText(previousAnalysis)))
    db.transaction((transaction) => completeReviewedAnswer(transaction, {
      jobId: params.deepSearchJobId, generationId: finalGenerationId,
      researchAnalysisGenerationId: previousAnalysis.generationId,
    }))
    params.publish({ type: "research-analysis", analysis })
    return finalAnswer
  }
  const researchAnalysisGeneration = await analyzeResearchAnswer({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    finalAnswer,
    searchSummaries: [...searchSummaries],
    sourceEvidence,
    requirements,
    workflowSignal: params.workflowSignal,
    onRegistered: (analysisGenerationId, transaction) => {
      if (previousAnalysis) {
        replaceResearchAnalysisGeneration(transaction, {
          ...replacementInput(
            params.deepSearchJobId,
            previousAnalysis,
            analysisGenerationId,
          ),
        })
      } else {
        attachResearchAnalysisGeneration(transaction, {
          jobId: params.deepSearchJobId,
          generationId: analysisGenerationId,
        })
      }
    },
  })
  const analysis = await researchAnalysisGeneration.analysis
  db.transaction((transaction) => completeReviewedAnswer(transaction, {
    jobId: params.deepSearchJobId,
    generationId: finalGenerationId,
    researchAnalysisGenerationId:
      researchAnalysisGeneration.generationId,
  }))
  params.publish({ type: "research-analysis", analysis })
  return finalAnswer
}

/** Coordinates the complete deep-search workflow and persists each stage before publishing it. */
function deepSearchPipelineEffect(
  params: DeepSearchPipelineInput,
): Effect.Effect<string, WorkflowFailure> {
  return Effect.gen(function*() {
    const initialSnapshot = yield* workflowEffect(() =>
      loadSnapshot(params.deepSearchJobId),
    )
    const durableParams: DeepSearchPipelineInput = {
      ...params,
      userId: initialSnapshot.userId,
      researchRequest: initialSnapshot.researchRequest,
      maxSearches: initialSnapshot.maxSearches,
      maxResultsPerSearch: initialSnapshot.maxResultsPerSearch,
      maxRounds: initialSnapshot.maxRounds,
    }
    const maxSearches = initialSnapshot.maxSearches
    const maxResultsPerSearch = initialSnapshot.maxResultsPerSearch
    const maxRounds = initialSnapshot.maxRounds
    const strictQuality = initialSnapshot.strictQuality
    const previousQueries: string[] = []
    const searchSummaries: SearchSummary[] = []
    const pageSummaries = new Map<string, string | undefined>(
      initialSnapshot.pages.map((page) => [
        page.url,
        page.status === "completed" &&
            page.summaryGeneration?.status === "completed"
          ? completedText(page.summaryGeneration).trim() || undefined
          : undefined,
      ]),
    )
    let previousCandidateAnswer: string | undefined
    let previousReviewReason: string | undefined

    const promotePersistedCandidate = (
      round: SearchRound,
      answerGenerationId: string,
      candidateAnswer: string,
    ): Effect.Effect<string, WorkflowFailure> =>
      workflowEffect(() => promoteCandidateAnswer(
          durableParams,
          round,
          answerGenerationId,
          candidateAnswer,
          searchSummaries,
        ))

    for (let roundPosition = 0; roundPosition < maxRounds; roundPosition += 1) {
      let snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      let snapshotRound = snapshot.rounds.find(
        ({ position }) => position === roundPosition,
      )
      let persistedRound: SearchRound

      if (snapshotRound?.planningGeneration.status === "completed") {
        persistedRound = {
          roundId: snapshotRound.roundId,
          position: snapshotRound.position,
          generationId: snapshotRound.planningGeneration.generationId,
        }
        const plan = parseResearchPlan(completedText(snapshotRound.planningGeneration))
        // Legacy planning atomically saved its filtered query rows. An empty
        // set can mean every raw query repeated earlier work; do not backfill it.
        if (snapshotRound.queries.length === 0 && plan.version === 1) {
          yield* workflowEffect(() =>
            savePlannedQueries({
              jobId: params.deepSearchJobId,
              roundId: snapshotRound!.roundId,
              queries: plan.queries,
            }),
          )
        }
      } else {
        const previousPlanning = snapshotRound?.planningGeneration
        let registeredRound: SearchRound | undefined
        const queryGeneration = yield* workflowEffect(() =>
          generateWebSearchQueries({
            userId: durableParams.userId,
            deepSearchJobId: durableParams.deepSearchJobId,
            researchRequest: durableParams.researchRequest,
            maxSearches,
            round: roundPosition,
            previousQueries: [...previousQueries],
            previousSearchSummaries: [...searchSummaries],
            previousCandidateAnswer,
            previousReviewReason,
            requirements: requirementsFromSnapshot(snapshot, roundPosition - 1),
            sourceEvidence: sourceEvidenceFromSnapshot(snapshot),
            workflowSignal: durableParams.workflowSignal,
            onRegistered: (generationId, transaction) => {
              if (snapshotRound && previousPlanning) {
                replaceRoundPlanningGeneration(transaction, {
                  ...replacementInput(
                    params.deepSearchJobId,
                    previousPlanning,
                    generationId,
                  ),
                  roundId: snapshotRound.roundId,
                })
                registeredRound = {
                  roundId: snapshotRound.roundId,
                  position: snapshotRound.position,
                  generationId,
                }
              } else {
                registeredRound = registerSearchRound(transaction, {
                  jobId: params.deepSearchJobId,
                  position: roundPosition,
                  generationId,
                })
              }
            },
            onCompleted: (completed, transaction) => {
              if (!registeredRound) {
                throw new Error("Search round generation was not registered")
              }
              savePlannedQueries(transaction, {
                jobId: params.deepSearchJobId,
                roundId: registeredRound.roundId,
                queries: completed.output,
              })
            },
          }),
        )
        persistedRound = yield* workflowEffect(async () => {
          if (!registeredRound) {
            await queryGeneration.queries.catch(() => undefined)
            throw new Error("Search round generation was not registered")
          }
          try {
            params.publish({
              type: "query-stream",
              round: roundPosition,
              streamId: queryGeneration.streamId,
            })
            return registeredRound
          } catch (error) {
            await queryGeneration.queries.catch(() => undefined)
            throw error
          }
        })
        const queries = yield* workflowEffect(() => queryGeneration.queries)
        const completedRound = yield* workflowEffect(() =>
          loadSnapshot(params.deepSearchJobId).rounds.find(
            ({ roundId }) => roundId === persistedRound.roundId,
          ),
        )
        if (
          !completedRound ||
          (completedRound.queries.length === 0 && queries.length > 0)
        ) {
          yield* workflowEffect(() =>
            savePlannedQueries({
              jobId: params.deepSearchJobId,
              roundId: persistedRound.roundId,
              queries,
            }),
          )
        }
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ position }) => position === roundPosition,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      const plan = parseResearchPlan(completedText(snapshotRound.planningGeneration))
      if (plan.version === 1) {
        const { requirements } = plan
        yield* workflowEffect(() => params.publish({ type: "research-requirements", round: roundPosition, requirements }))
      }
      const plannedQueries: PlannedQuery[] = snapshotRound.queries.map(
        ({ queryId, position, query }) => ({ queryId, position, query }),
      )
      let performedProviderSearch = false
      const executedQueries = yield* settleAll(
        plannedQueries.map((plannedQuery) =>
          workflowEffect(async () => {
            const current = loadSnapshot(params.deepSearchJobId)
              .rounds.find(({ roundId }) => roundId === persistedRound.roundId)
              ?.queries.find(({ queryId }) => queryId === plannedQuery.queryId)
            if (!current) throw new Error("Search query was not persisted")
            if (current.creditsUsed !== null) return toExecutedQuery(current)
            if (current.status === "failed" && current.errorStage === "search") {
              resetWebSearchQuery({
                jobId: params.deepSearchJobId,
                queryId: current.queryId,
              })
            }
            performedProviderSearch = true
            const search = await webSearch({
              userId: durableParams.userId,
              query: plannedQuery.query,
              signal: durableParams.workflowSignal,
            })
            const settlement = Array.isArray(search)
              ? { plannedQuery, results: search, creditsUsed: 0 }
              : { plannedQuery, ...search }
            return settleWebSearchQuery({
              userId: durableParams.userId,
              jobId: params.deepSearchJobId,
              roundId: persistedRound.roundId,
              ...settlement,
            })
          }),
        ),
      )
      yield* workflowEffect(() => {
        if (performedProviderSearch && executedQueries.length > 0) {
          params.publish({
            type: "search-results",
            round: roundPosition,
            searches: executedQueries.map(toPublicSearch),
          })
        }
      })
      previousQueries.push(...executedQueries.map(({ query }) => query))

      const pagesToSummarize = new Map<string, SelectedPage>()
      for (const search of executedQueries) {
        snapshot = yield* workflowEffect(() =>
          loadSnapshot(params.deepSearchJobId),
        )
        const persistedQuery = snapshot.rounds
          .find(({ roundId }) => roundId === persistedRound.roundId)
          ?.queries.find(({ queryId }) => queryId === search.queryId)
        if (!persistedQuery) {
          throw new WorkflowFailure({
            message: "Search query was not persisted",
          })
        }
        if (search.results.length === 0) {
          if (persistedQuery.status !== "completed") {
            yield* workflowEffect(() => {
              completeEmptySearchQuery({
                jobId: params.deepSearchJobId,
                queryId: search.queryId,
              })
              params.publish({
                type: "selected-search-results",
                round: roundPosition,
                query: search.query,
                selectedLinks: [],
              })
            })
          }
          continue
        }

        let selectedPages: SelectedPage[]
        if (
          persistedQuery.status !== "selecting" &&
          !(
            persistedQuery.status === "failed" &&
            persistedQuery.errorStage === "selection"
          )
        ) {
          const pagesById = new Map(
            snapshot.pages.map((page) => [page.pageId, page]),
          )
          selectedPages = selectedPagesFromSnapshot(persistedQuery, pagesById)
        } else {
          const previousSelection = persistedQuery.selectionGeneration
          let selectedIds: string[]
          let selectionGenerationId: string
          let completedSelectedPages: SelectedPage[] | undefined
          if (previousSelection?.status === "completed") {
            selectedIds = parseStringArray(previousSelection)
            selectionGenerationId = previousSelection.generationId
          } else {
            const selectionGeneration = yield* workflowEffect(() =>
              selectWebSearchResults({
                userId: durableParams.userId,
                deepSearchJobId: durableParams.deepSearchJobId,
                userQuery: durableParams.researchRequest,
                searchQuery: search.query,
                results: search.results.map((result) => ({
                  id: result.resultId,
                  title: result.title,
                  url: result.url,
                  snippet: result.shortText,
                })),
                maxResultsToExplore: maxResultsPerSearch,
                requirements: requirementsFromSnapshot(snapshot, roundPosition),
                knownPages: snapshot.pages.map(({ url, status }) => ({ url, status })),
                reviewReason: previousReviewReason,
                workflowSignal: durableParams.workflowSignal,
                onRegistered: (generationId, transaction) => {
                  if (previousSelection) {
                    replaceQuerySelectionGeneration(transaction, {
                      ...replacementInput(
                        params.deepSearchJobId,
                        previousSelection,
                        generationId,
                      ),
                      queryId: search.queryId,
                    })
                  } else {
                    registerSelectionGeneration(transaction, {
                      jobId: params.deepSearchJobId,
                      queryId: search.queryId,
                      generationId,
                    })
                  }
                },
                onCompleted: (completed, transaction) => {
                  completedSelectedPages = saveSelectedResults(transaction, {
                    jobId: params.deepSearchJobId,
                    queryId: search.queryId,
                    selectionGenerationId: completed.id,
                    selectedResultIds: completed.output,
                  })
                },
              }),
            )
            yield* workflowEffect(async () => {
              try {
                params.publish({
                  type: "selection-stream",
                  round: roundPosition,
                  query: search.query,
                  streamId: selectionGeneration.streamId,
                })
              } catch (error) {
                await selectionGeneration.selectedIds.catch(() => undefined)
                throw error
              }
            })
            selectedIds = yield* workflowEffect(
              () => selectionGeneration.selectedIds,
            )
            selectionGenerationId = selectionGeneration.streamId
          }
          const selectedResultIds = [
            ...new Set(
              selectedIds.filter((id) =>
                search.results.some(({ resultId }) => resultId === id),
              ),
            ),
          ]
          selectedPages = completedSelectedPages ??
            (yield* workflowEffect(() => {
              const completedQuery = loadSnapshot(params.deepSearchJobId)
                .rounds.find(
                  ({ roundId }) => roundId === persistedRound.roundId,
                )
                ?.queries.find(({ queryId }) => queryId === search.queryId)
              if (!completedQuery) {
                throw new Error("Search query was not persisted")
              }
              if (completedQuery.status !== "selecting") {
                const completedPagesById = new Map(
                  loadSnapshot(params.deepSearchJobId).pages.map((page) => [
                    page.pageId,
                    page,
                  ]),
                )
                return selectedPagesFromSnapshot(
                  completedQuery,
                  completedPagesById,
                )
              }
              return saveSelectedResults({
                jobId: params.deepSearchJobId,
                queryId: search.queryId,
                selectionGenerationId,
                selectedResultIds,
              })
            }))
          yield* workflowEffect(() => {
            params.publish({
              type: "selected-search-results",
              round: roundPosition,
              query: search.query,
              selectedLinks: selectedPages.map(({ url }) => url),
            })
          })
        }

        for (const page of selectedPages) {
          if (pagesToSummarize.has(page.url)) continue
          pagesToSummarize.set(page.url, page)
        }
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      const pagesById = new Map(
        snapshot.pages.map((page) => [page.pageId, page]),
      )
      const pageSummaryTasks = new Map<string, Promise<string | undefined>>()
      for (const page of pagesToSummarize.values()) {
        const snapshotPage = pagesById.get(page.pageId)
        if (!snapshotPage) {
          throw new WorkflowFailure({
            message: "Selected page was not persisted",
          })
        }
        pageSummaryTasks.set(
          page.url,
          addAbortableQueueTask(
            pageSummaryQueue,
            () =>
              summarizeSelectedPage(
                durableParams,
                snapshotPage,
                strictQuality,
              ),
            durableParams.workflowSignal,
          ),
        )
      }

      const settledPageSummaries = yield* settleAll(
        [...pageSummaryTasks].map(([url, task]) =>
          workflowEffect(async () => {
            const summary = await task
            return [url, summary] as const
          }),
        ),
      )
      for (const [url, summary] of settledPageSummaries) {
        pageSummaries.set(url, summary)
      }

      yield* exploreLinkedPages(
        durableParams,
        persistedRound,
        [...pagesToSummarize.values()],
        pageSummaries,
        strictQuality,
        maxSearches,
        maxResultsPerSearch,
      )

      const roundSummaries = yield* settleAll(
        executedQueries.map((search) =>
          workflowEffect(async () => {
            if (search.results.length === 0) {
              return {
                round: roundPosition,
                query: search.query,
                content: EMPTY_SEARCH_SUMMARY,
              }
            }
            const current = loadSnapshot(params.deepSearchJobId)
              .rounds.find(({ roundId }) => roundId === persistedRound.roundId)
              ?.queries.find(({ queryId }) => queryId === search.queryId)
            if (!current) throw new Error("Search query was not persisted")
            if (
              current.status === "completed" &&
              current.summaryGeneration?.status === "completed"
            ) {
              return {
                round: roundPosition,
                query: search.query,
                content: completedText(current.summaryGeneration).trim(),
              }
            }
            const previousSummary = current.summaryGeneration
            const generation = await summarizeSearchQuery({
              userId: durableParams.userId,
              deepSearchJobId: durableParams.deepSearchJobId,
              researchRequest: durableParams.researchRequest,
              query: search.query,
              results: search.results.map((result) => ({
                title: result.title,
                url: result.url,
                content: pageSummaries.get(result.url) || result.shortText,
                evidenceType: pageSummaries.get(result.url) ? "page-summary" : "search-snippet",
              })),
              workflowSignal: durableParams.workflowSignal,
              onRegistered: (generationId, transaction) => {
                if (previousSummary) {
                  replaceQuerySummaryGeneration(transaction, {
                    ...replacementInput(
                      params.deepSearchJobId,
                      previousSummary,
                      generationId,
                    ),
                    queryId: search.queryId,
                  })
                } else {
                  attachQuerySummaryGeneration(transaction, {
                    jobId: params.deepSearchJobId,
                    queryId: search.queryId,
                    generationId,
                  })
                }
              },
              onCompleted: (completed, transaction) => {
                completeQuerySummaryGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  queryId: search.queryId,
                  generationId: completed.id,
                })
              },
              onFailed: (failed, transaction) => {
                failQuerySummaryGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  queryId: search.queryId,
                  generationId: failed.id,
                  message: failed.error,
                })
              },
              onInterrupted: (interrupted, transaction) => {
                interruptQuerySummaryGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  queryId: search.queryId,
                  generationId: interrupted.id,
                  message: interrupted.error,
                })
              },
            })
            try {
              params.publish({
                type: "query-summary-stream",
                round: roundPosition,
                query: search.query,
                streamId: generation.streamId,
              })
            } catch (error) {
              await generation.summary.catch(() => undefined)
              throw error
            }
            return {
              round: roundPosition,
              query: search.query,
              content: (await generation.summary).trim(),
            }
          }),
        ),
      )
      searchSummaries.push(...roundSummaries)

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ roundId }) => roundId === persistedRound.roundId,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      let answerGenerationId: string
      let candidateAnswer: string
      if (snapshotRound.answerGeneration?.status === "completed") {
        answerGenerationId = snapshotRound.answerGeneration.generationId
        candidateAnswer = completedText(snapshotRound.answerGeneration)
      } else {
        const previousAnswer = snapshotRound.answerGeneration
        const candidate = yield* workflowEffect(() =>
          answerResearchRequest({
            userId: durableParams.userId,
            deepSearchJobId: durableParams.deepSearchJobId,
            researchRequest: durableParams.researchRequest,
            searchSummaries: [...searchSummaries],
            sourceEvidence: sourceEvidenceFromSnapshot(loadSnapshot(params.deepSearchJobId)),
            requirements: requirementsFromSnapshot(loadSnapshot(params.deepSearchJobId), roundPosition),
            workflowSignal: durableParams.workflowSignal,
            onRegistered: (generationId, transaction) => {
              if (previousAnswer) {
                replaceRoundAnswerGeneration(transaction, {
                  ...replacementInput(
                    params.deepSearchJobId,
                    previousAnswer,
                    generationId,
                  ),
                  roundId: persistedRound.roundId,
                })
              } else {
                attachRoundAnswerGeneration(transaction, {
                  jobId: params.deepSearchJobId,
                  roundId: persistedRound.roundId,
                  generationId,
                })
              }
            },
          }),
        )
        yield* workflowEffect(async () => {
          try {
            params.publish({
              type: "round-answer-stream",
              round: roundPosition,
              streamId: candidate.streamId,
            })
          } catch (error) {
            await candidate.answer.catch(() => undefined)
            throw error
          }
        })
        candidateAnswer = yield* workflowEffect(() => candidate.answer)
        answerGenerationId = candidate.streamId
      }

      if (roundPosition + 1 >= maxRounds) {
        return yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
        )
      }

      snapshot = yield* workflowEffect(() =>
        loadSnapshot(params.deepSearchJobId),
      )
      snapshotRound = snapshot.rounds.find(
        ({ roundId }) => roundId === persistedRound.roundId,
      )
      if (!snapshotRound) {
        throw new WorkflowFailure({ message: "Round was not persisted" })
      }
      let decision: RoundReview | undefined
      let decisionWasPersisted = false
      if (snapshotRound.reviewError !== null) {
        decision = undefined
      } else if (
        snapshotRound.reviewDecision !== null &&
        snapshotRound.reviewReason !== null
      ) {
        decision = {
          decision: snapshotRound.reviewDecision,
          reason: snapshotRound.reviewReason,
        }
        decisionWasPersisted = true
      } else {
        decision = yield* workflowEffect(() =>
          reviewSearchRound(
            durableParams,
            persistedRound,
            maxRounds,
            searchSummaries,
            candidateAnswer,
            snapshotRound.reviewGeneration ?? undefined,
          ),
        )
      }
      if (!decision) {
        return yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
        )
      }

      if (!decisionWasPersisted) {
        yield* workflowEffect(() =>
          params.publish({
            type: "round-review",
            round: roundPosition,
            decision: decision.decision,
            reason: decision.reason,
          }),
        )
      }
      const completedReview = loadSnapshot(params.deepSearchJobId).rounds
        .find(({ roundId }) => roundId === persistedRound.roundId)?.reviewGeneration
      if (completedReview?.status === "completed") {
        const { requirements } = roundReviewSchema.parse(secureJsonParse(completedText(completedReview)))
        if (requirements !== undefined) {
          yield* workflowEffect(() => params.publish({ type: "research-requirements", round: roundPosition, requirements }))
        }
      }
      if (decision.decision === "stop") {
        return yield* promotePersistedCandidate(
          persistedRound,
          answerGenerationId,
          candidateAnswer,
        )
      }
      previousCandidateAnswer = candidateAnswer
      previousReviewReason = decision.reason
    }

    return yield* Effect.fail(
      new WorkflowFailure({
        message: "Deep-search pipeline exhausted without a candidate answer",
      }),
    )
  })
}

/** Effect-owned coordinator with a single Promise-facing runtime boundary. */
export async function runDeepSearchPipeline(
  params: DeepSearchPipelineInput,
): Promise<string> {
  return runWorkflowEffect(
    deepSearchPipelineEffect(params),
    params.workflowSignal,
  )
}
