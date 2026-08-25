/** Stable in-process records passed between deep-search pipeline stages. */
export type SearchRound = {
  roundId: string
  position: number
  generationId: string
}

export type PlannedQuery = {
  queryId: string
  position: number
  query: string
}

export type SearchResultRecord = {
  resultId: string
  position: number
  title: string
  shortText: string
  url: string
}

export type ExecutedQuery = PlannedQuery & {
  results: SearchResultRecord[]
}

export type SettledSearchQuery = ExecutedQuery & { creditsUsed: number }

export type SelectedPage = {
  pageId: string
  url: string
}

export type PersistedGeneration = {
  generationId: string
  status: "running" | "completed" | "failed" | "interrupted"
  text: string | null
  reasoning: string | null
  error: string | null
}

export type DeepSearchExecutionSnapshot = {
  jobId: string
  userId: string
  ideaJobId: string | null
  researchRequest: string
  maxSearches: number
  maxResultsPerSearch: number
  maxRounds: number
  strictQuality: boolean
  status: "running" | "completed" | "failed" | "interrupted"
  error: string | null
  cancelRequestedAt: Date | null
  completedAt: Date | null
  finalAnswerGeneration: PersistedGeneration | null
  researchAnalysisGeneration: PersistedGeneration | null
  rounds: Array<{
    roundId: string
    position: number
    planningGeneration: PersistedGeneration
    answerGeneration: PersistedGeneration | null
    reviewGeneration: PersistedGeneration | null
    reviewDecision: "continue" | "stop" | null
    reviewReason: string | null
    reviewError: string | null
    reviewCompletedAt: Date | null
    queries: Array<{
      queryId: string
      position: number
      query: string
      creditsUsed: number | null
      status: "searching" | "selecting" | "summarizing" | "completed" | "failed"
      selectionGeneration: PersistedGeneration | null
      summaryGeneration: PersistedGeneration | null
      errorStage: "search" | "selection" | "summary" | null
      errorMessage: string | null
      completedAt: Date | null
      results: Array<SearchResultRecord & { selectedWebPageId: string | null }>
    }>
  }>
  pages: Array<{
    pageId: string
    url: string
    creditsUsed: number | null
    status: "pending" | "extracting" | "summarizing" | "completed" | "failed"
    extractedContent: string | null
    summaryGeneration: PersistedGeneration | null
    errorStage: "extraction" | "summary" | null
    errorMessage: string | null
    completedAt: Date | null
  }>
}
