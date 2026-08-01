import z from "zod"
import { collectStreamText } from "../../helpers/index.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  deepSearchInputSchema,
  deepSearchSearchSchema,
} from "./schemas.ts"

const searchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})

const onStreamCreatedSchema = z
  .function()
  .input(z.tuple([z.string()]))
  .output(z.void())

/**
 * Asks the LLM to rank result IDs, exposes the selection stream immediately, and
 * returns only the highest-priority IDs up to the exploration limit.
 */
export const selectWebSearchResults = z
  .function()
  .input(
    z.tuple([
      z.object({
        userQuery: z.string(),
        searchQuery: z.string(),
        results: z.array(searchResultSchema),
        maxResultsToExplore: z.number().int().positive().default(3),
        onStreamCreated: onStreamCreatedSchema,
      }),
    ]),
  )
  .output(z.array(z.string()))
  .implementAsync(async (params) => {
    const formattedResults = params.results
      .map(
        (result) =>
          `ID: ${result.id}\nTitle: ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`,
      )
      .join("\n\n")

    const prompt = [
      `user_query: ${params.userQuery}`,
      `search_query: ${params.searchQuery}`,
      `max_results_to_explore: ${params.maxResultsToExplore}`,
      "results:",
      formattedResults,
    ].join("\n")

    const { id } = await generateTextStream({
      prompt,
      promptName: PromptName.SelectWebSearchResults,
    })
    params.onStreamCreated(id)

    const text = await collectStreamText({ id })
    const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "")
    return z
      .array(z.string())
      .parse(JSON.parse(cleaned))
      .slice(0, params.maxResultsToExplore)
  })

const selectSearchResultsInputSchema = deepSearchInputSchema
  .pick({
    researchRequest: true,
    maxResultsPerSearch: true,
    onEvent: true,
  })
  .extend({ search: deepSearchSearchSchema })

const selectedSearchResultsSchema = deepSearchSearchSchema.extend({
  selectedLinks: z.array(z.string()),
})

/**
 * Adapts domain search results to stable IDs for LLM selection, announces the
 * selection stream, and maps the chosen IDs back to their original links.
 */
export const selectSearchResults = z
  .function()
  .input(z.tuple([selectSearchResultsInputSchema]))
  .output(selectedSearchResultsSchema)
  .implementAsync(async (params) => {
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
    })
    const linksById = new Map(
      indexedResults.map((result) => [result.id, result.url]),
    )
    const selectedLinks = selectedIds
      .map((id) => linksById.get(id))
      .filter((link): link is string => link !== undefined)

    return { query, results, selectedLinks }
  })
