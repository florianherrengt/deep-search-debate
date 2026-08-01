import { produce, type Draft } from "immer"
import type {
  DeepSearchJobEvent,
  DeepSearchResults,
} from "../../lib/deepSearchJobs.ts"

export type DeepSearchPageSummary =
  | { status: "extracting" }
  | { status: "stream"; streamId: string }
  | { status: "error"; message: string }

export type DeepSearchResultState = DeepSearchResults["results"][number] & {
  selection: "pending" | "selected" | "rejected"
  summary?: DeepSearchPageSummary
}

export type DeepSearchSearchState = {
  query: string
  results: DeepSearchResultState[]
  selectionStreamId?: string
}

export type DeepSearchRunState = {
  status: "idle" | "running" | "completed" | "failed"
  jobId: string | null
  queryStreamId: string | null
  searches: DeepSearchSearchState[]
  error: string | null
}

export const initialDeepSearchState: DeepSearchRunState = {
  status: "idle",
  jobId: null,
  queryStreamId: null,
  searches: [],
  error: null,
}

type DeepSearchAction =
  | DeepSearchJobEvent
  | { type: "started" }
  | { type: "created"; jobId: string }
  | { type: "request-failed"; message: string }

function createSearchState(
  searches: DeepSearchResults[],
): DeepSearchSearchState[] {
  return searches.map((search) => ({
    ...search,
    results: search.results.map((result) => ({
      ...result,
      selection: "pending",
    })),
  }))
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
}

/** Folds local lifecycle actions and server events into rendered job state. */
export const deepSearchReducer = produce<
  DeepSearchRunState,
  [DeepSearchAction]
>((state, action) => {
  switch (action.type) {
    case "started":
      return { ...initialDeepSearchState, status: "running" }
    case "created":
      state.jobId = action.jobId
      break
    case "query-stream":
      state.queryStreamId = action.streamId
      break
    case "search-results":
      state.searches = createSearchState(action.searches)
      break
    case "selection-stream": {
      const search = state.searches.find(({ query }) => query === action.query)
      if (search) search.selectionStreamId = action.streamId
      break
    }
    case "selected-search-results": {
      const search = state.searches.find(({ query }) => query === action.query)
      if (!search) break

      const selectedLinks = new Set(action.selectedLinks)
      for (const result of search.results) {
        if (selectedLinks.has(result.link)) {
          result.selection = "selected"
          result.summary ??= { status: "extracting" }
        } else {
          result.selection = "rejected"
          delete result.summary
        }
      }
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
    case "error":
    case "request-failed":
      state.status = "failed"
      state.error = action.message
      break
    case "done":
      if (state.status !== "failed") {
        state.status = "completed"
      }
      break
  }
})
