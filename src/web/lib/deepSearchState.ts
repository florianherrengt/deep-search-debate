import { produce, type Draft } from "immer"
import type {
  DeepSearchJobEvent,
  DeepSearchResults,
  ResearchAnalysis,
  ResearchRequirements,
} from "./deepSearchJobs.ts"

export type DeepSearchPageSummary =
  | { status: "extracting" }
  | { status: "stream"; streamId: string }
  | { status: "error"; message: string }

export type DeepSearchResultState = DeepSearchResults["results"][number] & {
  selection: "pending" | "selected" | "rejected"
  summary?: DeepSearchPageSummary
}

export type DeepSearchSearchState = {
  round: number
  query: string
  results: DeepSearchResultState[]
  selectionStreamId?: string
  querySummaryStreamId?: string
}

export type DeepSearchLinkedSourceState = {
  sourceUrl: string
  selectionStreamId?: string
  links?: Array<{ url: string; title: string; summary: DeepSearchPageSummary }>
}

type DeepSearchQueryGenerationState = {
  round: number
  streamId: string
}

type DeepSearchRoundAnswerState = {
  round: number
  streamId: string
}

export type DeepSearchRoundReviewState = {
  round: number
  streamId?: string
  status: "running" | "continue" | "stop" | "error"
  reason?: string
}

export type DeepSearchRunState = {
  status:
    | "idle"
    | "running"
    | "stopping"
    | "completed"
    | "failed"
    | "interrupted"
  queryGenerations: DeepSearchQueryGenerationState[]
  roundAnswers: DeepSearchRoundAnswerState[]
  roundReviews: DeepSearchRoundReviewState[]
  roundRequirements: Array<{ round: number; requirements: ResearchRequirements }>
  finalAnswerStreamId: string | null
  researchAnalysis: ResearchAnalysis | null
  searches: DeepSearchSearchState[]
  linkedSources: DeepSearchLinkedSourceState[]
  error: string | null
}

export const initialDeepSearchState: DeepSearchRunState = {
  status: "idle",
  queryGenerations: [],
  roundAnswers: [],
  roundReviews: [],
  roundRequirements: [],
  finalAnswerStreamId: null,
  researchAnalysis: null,
  searches: [],
  linkedSources: [],
  error: null,
}

type DeepSearchAction = DeepSearchJobEvent | { type: "opened" }

function createSearchState(
  round: number,
  searches: DeepSearchResults[],
): DeepSearchSearchState[] {
  return searches.map((search) => ({
    round,
    ...search,
    results: search.results.map((result) => ({
      ...result,
      selection: "pending",
    })),
  }))
}

function findSearch(
  state: Draft<DeepSearchRunState>,
  round: number,
  query: string,
) {
  return state.searches.find(
    (search) => search.round === round && search.query === query,
  )
}

function findReview(state: Draft<DeepSearchRunState>, round: number) {
  return state.roundReviews.find((review) => review.round === round)
}

function setPageSummary(
  state: Draft<DeepSearchRunState>,
  url: string,
  summary: DeepSearchPageSummary,
): void {
  for (const search of state.searches) {
    for (const result of search.results) {
      if (result.link === url && result.selection === "selected") {
        result.summary = summary
      }
    }
  }
  for (const source of state.linkedSources) {
    for (const link of source.links ?? []) {
      if (link.url === url) link.summary = summary
    }
  }
}

function findPageSummary(
  state: Draft<DeepSearchRunState>,
  url: string,
): DeepSearchPageSummary | undefined {
  for (const search of state.searches) {
    const summary = search.results.find(
      (result) => result.link === url && result.summary !== undefined,
    )?.summary
    if (summary) return summary
  }
  for (const source of state.linkedSources) {
    const summary = source.links?.find((link) => link.url === url)?.summary
    if (summary) return summary
  }
}

/** Folds local lifecycle actions and server events into rendered job state. */
export const deepSearchReducer = produce<
  DeepSearchRunState,
  [DeepSearchAction]
>((state, action) => {
  switch (action.type) {
    case "opened":
      return { ...initialDeepSearchState, status: "running" }
    case "query-stream":
      state.queryGenerations = state.queryGenerations.filter(
        ({ round }) => round !== action.round,
      )
      state.queryGenerations.push({
        round: action.round,
        streamId: action.streamId,
      })
      state.queryGenerations.sort((first, second) => first.round - second.round)
      break
    case "research-requirements":
      state.roundRequirements = state.roundRequirements.filter(({ round }) => round !== action.round)
      state.roundRequirements.push({ round: action.round, requirements: action.requirements })
      state.roundRequirements.sort((first, second) => first.round - second.round)
      break
    case "search-results":
      state.searches = state.searches.filter(
        ({ round }) => round !== action.round,
      )
      state.searches.push(...createSearchState(action.round, action.searches))
      state.searches.sort((first, second) => first.round - second.round)
      break
    case "selection-stream": {
      const search = findSearch(state, action.round, action.query)
      if (search) search.selectionStreamId = action.streamId
      break
    }
    case "selected-search-results": {
      const search = findSearch(state, action.round, action.query)
      if (!search) break

      const selectedLinks = new Set(action.selectedLinks)
      for (const result of search.results) {
        if (selectedLinks.has(result.link)) {
          result.selection = "selected"
          result.summary ??=
            findPageSummary(state, result.link) ?? { status: "extracting" }
        } else {
          result.selection = "rejected"
          delete result.summary
        }
      }
      break
    }
    case "linked-page-selection-stream": {
      const source = state.linkedSources.find(({ sourceUrl }) => sourceUrl === action.sourceUrl)
      if (source) source.selectionStreamId = action.streamId
      else state.linkedSources.push({ sourceUrl: action.sourceUrl, selectionStreamId: action.streamId })
      break
    }
    case "selected-linked-pages": {
      const source = state.linkedSources.find(({ sourceUrl }) => sourceUrl === action.sourceUrl)
      const seen = new Set<string>()
      const links = action.links.filter(({ url }) => {
        if (seen.has(url)) return false
        seen.add(url)
        return true
      }).map((link) => ({
        ...link,
        summary: findPageSummary(state, link.url) ?? { status: "extracting" as const },
      }))
      if (source) source.links = links
      else state.linkedSources.push({ sourceUrl: action.sourceUrl, links })
      break
    }
    case "page-summary-stream":
      setPageSummary(state, action.url, {
        status: "stream",
        streamId: action.streamId,
      })
      break
    case "page-summary-error":
      setPageSummary(state, action.url, {
        status: "error",
        message: action.message,
      })
      break
    case "query-summary-stream": {
      const search = findSearch(state, action.round, action.query)
      if (search) search.querySummaryStreamId = action.streamId
      break
    }
    case "round-answer-stream":
      state.roundAnswers = state.roundAnswers.filter(
        ({ round }) => round !== action.round,
      )
      state.roundAnswers.push({
        round: action.round,
        streamId: action.streamId,
      })
      state.roundAnswers.sort((first, second) => first.round - second.round)
      break
    case "round-review-stream": {
      const review = findReview(state, action.round)
      if (review) {
        review.streamId = action.streamId
        review.status = "running"
        delete review.reason
      } else {
        state.roundReviews.push({
          round: action.round,
          streamId: action.streamId,
          status: "running",
        })
      }
      state.roundReviews.sort((first, second) => first.round - second.round)
      break
    }
    case "round-review": {
      const review = findReview(state, action.round)
      if (review) {
        review.status = action.decision
        review.reason = action.reason
      } else {
        state.roundReviews.push({
          round: action.round,
          status: action.decision,
          reason: action.reason,
        })
      }
      break
    }
    case "round-review-error": {
      const review = findReview(state, action.round)
      if (review) {
        review.status = "error"
        review.reason = action.message
      } else {
        state.roundReviews.push({
          round: action.round,
          status: "error",
          reason: action.message,
        })
      }
      break
    }
    case "final-answer-stream":
      state.finalAnswerStreamId = action.streamId
      break
    case "research-analysis":
      state.researchAnalysis = action.analysis
      break
    case "stop-requested":
      if (state.status === "idle" || state.status === "running") {
        state.status = "stopping"
      }
      break
    case "interrupted":
      state.status = "interrupted"
      state.error = action.message
      break
    case "error":
      state.status = "failed"
      state.error = action.message
      break
    case "done":
      if (
        state.status !== "failed" &&
        state.status !== "interrupted" &&
        state.status !== "stopping"
      ) {
        state.status = "completed"
      }
      break
  }
})
