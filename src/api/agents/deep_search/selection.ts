import z from "zod"
import { generateArrayStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import type { DeepSearchEvent, DeepSearchSearch } from "./schemas.ts"

type IndexedSearchResult = {
  id: string
  title: string
  url: string
  snippet: string
}

type SelectWebSearchResultsInput = {
  userQuery: string
  searchQuery: string
  results: IndexedSearchResult[]
  maxResultsToExplore?: number
  onStreamCreated: (streamId: string) => void
  maxRetries?: number
}

/**
 * Asks the LLM to rank result IDs, exposes the selection stream immediately, and
 * returns only the highest-priority IDs up to the exploration limit.
 */
export async function selectWebSearchResults(
  params: SelectWebSearchResultsInput,
): Promise<string[]> {
  const maxResultsToExplore = params.maxResultsToExplore ?? 3
  const formattedResults = params.results
    .map(
      (result) =>
        `ID: ${result.id}\nTitle: ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`,
    )
    .join("\n\n")

  const prompt = [
    `user_query: ${params.userQuery}`,
    `search_query: ${params.searchQuery}`,
    `max_results_to_explore: ${maxResultsToExplore}`,
    "results:",
    formattedResults,
  ].join("\n")

  const { id, output } = await generateArrayStream({
    prompt,
    promptName: PromptName.SelectWebSearchResults,
    element: z.string().min(1),
    maxRetries: params.maxRetries,
  })
  params.onStreamCreated(id)

  return (await output).slice(0, maxResultsToExplore)
}

type SelectSearchResultsInput = {
  researchRequest: string
  maxResultsPerSearch: number
  onEvent: (event: DeepSearchEvent) => void
  search: DeepSearchSearch
  maxRetries?: number
}

type SelectedSearchResults = DeepSearchSearch & { selectedLinks: string[] }

/**
 * Adapts domain search results to stable IDs for LLM selection, announces the
 * selection stream, and maps the chosen IDs back to their original links.
 */
export async function selectSearchResults(
  params: SelectSearchResultsInput,
): Promise<SelectedSearchResults> {
  const { query, results } = params.search
  const indexedResults = results.map((result, index) => ({
    id: `result-${index}`,
    title: result.title,
    url: result.link,
    snippet: result.shortText,
  }))
  const selectedIds = await selectWebSearchResults({
    userQuery: params.researchRequest,
    searchQuery: query,
    results: indexedResults,
    maxResultsToExplore: params.maxResultsPerSearch,
    onStreamCreated: (streamId) => {
      params.onEvent({ type: "selection-stream", query, streamId })
    },
    maxRetries: params.maxRetries,
  })
  const linksById = new Map(
    indexedResults.map((result) => [result.id, result.url]),
  )
  const selectedLinks = selectedIds
    .map((id) => linksById.get(id))
    .filter((link): link is string => link !== undefined)

  return { query, results, selectedLinks }
}
