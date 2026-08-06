import z from "zod"
import { generateArrayStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { webSearch } from "../../web_search/index.ts"
import type {
  DeepSearchEvent,
  DeepSearchSearchResults,
} from "./schemas.ts"

type GenerateWebSearchQueriesInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  onStreamCreated: (streamId: string) => void
  maxRetries?: number
}

/**
 * Registers the query-generation text stream, announces its ID immediately, and
 * then collects the completed output into an ordered list of search queries.
 */
export async function generateWebSearchQueries(
  params: GenerateWebSearchQueriesInput,
): Promise<string[]> {
  const { id, output } = await generateArrayStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt: params.researchRequest,
    promptName: PromptName.GenerateWebSearchQueries,
    element: z.string().trim().min(1),
    maxRetries: params.maxRetries,
  })
  params.onStreamCreated(id)

  return [...new Set(await output)]
}

type GenerateSearchResultsInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  maxSearches: number
  onEvent: (event: DeepSearchEvent) => void
  onQueriesGenerated?: (queries: string[]) => void
  maxRetries?: number
}

/**
 * Generates prioritized queries and executes the configured number of web
 * searches in parallel while exposing the query-generation stream to callers.
 */
export async function generateSearchResults(
  params: GenerateSearchResultsInput,
): Promise<DeepSearchSearchResults> {
  const queries = await generateWebSearchQueries({
    userId: params.userId,
    deepSearchJobId: params.deepSearchJobId,
    researchRequest: params.researchRequest,
    onStreamCreated: (streamId) => {
      params.onEvent({ type: "query-stream", streamId })
    },
    maxRetries: params.maxRetries,
  })
  params.onQueriesGenerated?.(queries)

  return Promise.all(
    queries.slice(0, params.maxSearches).map(async (query) => ({
      query,
      results: await webSearch({ query }),
    })),
  )
}
