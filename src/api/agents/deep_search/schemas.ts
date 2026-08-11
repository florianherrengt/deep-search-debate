type DeepSearchResult = {
  title: string
  shortText: string
  link: string
}

export type DeepSearchSearch = {
  query: string
  results: DeepSearchResult[]
}

type DeepSearchSearchResults = DeepSearchSearch[]

export type DeepSearchEvent =
  | { type: "query-stream"; round: number; streamId: string }
  | { type: "search-results"; round: number; searches: DeepSearchSearchResults }
  | { type: "selection-stream"; round: number; query: string; streamId: string }
  | {
      type: "selected-search-results"
      round: number
      query: string
      selectedLinks: string[]
    }
  | { type: "page-summary-stream"; url: string; streamId: string }
  | {
      type: "page-summary-error"
      url: string
      stage: "extraction" | "summary"
      message: string
    }
  | {
      type: "query-summary-stream"
      round: number
      query: string
      streamId: string
    }
  | { type: "round-review-stream"; round: number; streamId: string }
  | {
      type: "round-review"
      round: number
      decision: "continue" | "stop"
      reason: string
    }
  | { type: "round-review-error"; round: number; message: string }
  | { type: "final-answer-stream"; streamId: string }
