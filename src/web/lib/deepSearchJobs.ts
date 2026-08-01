import { postForId, subscribeToNdjson } from "./api.ts"

type DeepSearchResult = {
  title: string
  shortText: string
  link: string
}

export type DeepSearchResults = {
  query: string
  results: DeepSearchResult[]
}

export type DeepSearchJobEvent =
  | { type: "query-stream"; streamId: string }
  | { type: "search-results"; searches: DeepSearchResults[] }
  | { type: "selection-stream"; query: string; streamId: string }
  | { type: "selected-search-results"; query: string; selectedLinks: string[] }
  | { type: "page-summary-stream"; url: string; streamId: string }
  | {
      type: "page-summary-error"
      url: string
      stage: "extraction" | "summary"
      message: string
    }
  | { type: "error"; message: string }
  | { type: "done" }

type CreateDeepSearchJobInput = {
  researchRequest: string
  maxSearches?: number
  maxResultsPerSearch?: number
}

export async function createDeepSearchJob(
  input: CreateDeepSearchJobInput,
  signal?: AbortSignal,
): Promise<string> {
  return postForId(
    "/api/deep-search",
    {
      researchRequest: input.researchRequest,
      maxSearches: input.maxSearches ?? 3,
      maxResultsPerSearch: input.maxResultsPerSearch ?? 3,
    },
    signal,
  )
}

export async function* subscribeToDeepSearchJob(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<DeepSearchJobEvent> {
  yield* subscribeToNdjson<DeepSearchJobEvent>(
    `/api/deep-search/${encodeURIComponent(id)}`,
    signal,
  )
}
