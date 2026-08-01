import z from "zod"
import { collectStreamText } from "../../helpers/index.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { webSearch } from "../../web_search/index.ts"
import {
  deepSearchInputSchema,
  deepSearchSearchResultsSchema,
} from "./schemas.ts"

const onStreamCreatedSchema = z
  .function()
  .input(z.tuple([z.string()]))
  .output(z.void())

/**
 * Registers the query-generation text stream, announces its ID immediately, and
 * then collects the completed output into an ordered list of search queries.
 */
export const generateWebSearchQueries = z
  .function()
  .input(
    z.tuple([
      z.object({
        researchRequest: z.string(),
        onStreamCreated: onStreamCreatedSchema,
      }),
    ]),
  )
  .output(z.array(z.string()))
  .implementAsync(async (params) => {
    const { id } = await generateTextStream({
      prompt: params.researchRequest,
      promptName: PromptName.GenerateWebSearchQueries,
    })
    params.onStreamCreated(id)

    const text = await collectStreamText({ id })
    return text
      .split("\n")
      .map((query) => query.trim())
      .filter(Boolean)
  })

const generateSearchResultsInputSchema = deepSearchInputSchema.pick({
  researchRequest: true,
  maxSearches: true,
  onEvent: true,
})

/**
 * Generates prioritized queries and executes the configured number of web
 * searches in parallel while exposing the query-generation stream to callers.
 */
export const generateSearchResults = z
  .function()
  .input(z.tuple([generateSearchResultsInputSchema]))
  .output(deepSearchSearchResultsSchema)
  .implementAsync(async (params) => {
    const queries = await generateWebSearchQueries({
      researchRequest: params.researchRequest,
      onStreamCreated: (streamId) => {
        params.onEvent({ type: "query-stream", streamId })
      },
    })

    return Promise.all(
      queries.slice(0, params.maxSearches).map(async (query) => ({
        query,
        results: await webSearch({ query }),
      })),
    )
  })
