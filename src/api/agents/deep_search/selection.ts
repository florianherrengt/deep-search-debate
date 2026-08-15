import z from "zod"
import { generateArrayStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
} from "../../llms/streams.ts"

type IndexedSearchResult = {
  id: string
  title: string
  url: string
  snippet: string
}

type SelectWebSearchResultsInput = {
  userId: string
  deepSearchJobId: string
  userQuery: string
  searchQuery: string
  results: IndexedSearchResult[]
  maxResultsToExplore?: number
  workflowSignal?: AbortSignal
}

export type SelectionGeneration = {
  streamId: string
  selectedIds: Promise<string[]>
  completion: Promise<GenerationOutcome>
}

/**
 * Starts LLM result ranking and exposes the stream, durable completion, and
 * validated selected IDs separately.
 */
export async function selectWebSearchResults(
  params: SelectWebSearchResultsInput,
): Promise<SelectionGeneration> {
  const maxResultsToExplore = params.maxResultsToExplore ?? 3
  const formattedResults = params.results
    .map((result) => `<search_result>${JSON.stringify(result)}</search_result>`)
    .join("\n\n")

  const prompt = [
    `user_query: ${params.userQuery}`,
    `search_query: ${params.searchQuery}`,
    `max_results_to_explore: ${maxResultsToExplore}`,
    "<search_results>",
    formattedResults,
    "</search_results>",
  ].join("\n")

  const generation = await generateArrayStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.SelectWebSearchResults,
    element: z.string(),
    maxOutputTokens: 1_024,
    workflowSignal: params.workflowSignal,
  })
  const knownIds = new Set(params.results.map(({ id }) => id))

  return {
    streamId: generation.id,
    selectedIds: awaitGenerationOutput(
      generation,
      generation.output,
    ).then((ids) => {
      // TODO: Reject unknown or duplicate selector IDs at the model boundary.
      // For now they are ignored and do not consume the exploration quota.
      return [...new Set(ids.filter((id) => knownIds.has(id)))].slice(
        0,
        maxResultsToExplore,
      )
    }),
    completion: generation.completion,
  }
}
