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

export type SelectedPage = {
  pageId: string
  url: string
}
