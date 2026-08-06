type DeepSearchResult = {
  title: string
  shortText: string
  link: string
}

export type DeepSearchSearch = {
  query: string
  results: DeepSearchResult[]
}

export type DeepSearchSearchResults = DeepSearchSearch[]

export type DeepSearchEvent =
  | { type: "query-stream"; streamId: string }
  | { type: "search-results"; searches: DeepSearchSearchResults }
  | { type: "selection-stream"; query: string; streamId: string }
  | { type: "selected-search-results"; query: string; selectedLinks: string[] }
  | { type: "page-summary-stream"; url: string; streamId: string }
  | {
      type: "page-summary-error"
      url: string
      stage: "extraction" | "summary"
      message: string
    }
  | { type: "query-summary-stream"; query: string; streamId: string }
  | { type: "final-answer-stream"; streamId: string }

export type DeepSearchInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  maxSearches?: number
  maxResultsPerSearch?: number
  maxRetries?: number
  onEvent: (event: DeepSearchEvent) => void
  onQueriesGenerated?: (queries: string[]) => void
}
