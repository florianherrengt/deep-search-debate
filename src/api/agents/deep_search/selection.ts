import z from "zod"
import { generateArrayStream, generateObjectStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import { formatBoundedTextEntries } from "../../helpers/boundedText.ts"
import { config } from "../../config.ts"
import { pageLinkSelectionSchema, type ResearchRequirements } from "./schemas.ts"

type IndexedSearchResult = {
  id: string
  title: string
  url: string
  snippet: string
}

/** Selects evidence-bearing links actually discovered on a retrieved source. */
export async function selectPageLinks(
  params: Omit<SelectWebSearchResultsInput, "searchQuery" | "results"> & {
    sourceUrl: string
    sourceSummary: string
    links: Array<{ id: string; url: string; title: string }>
  },
): Promise<SelectionGeneration> {
  const limit = params.maxResultsToExplore ?? 3
  if (params.links.length === 0 || limit <= 0) {
    throw new Error("Link selection requires candidates and remaining capacity")
  }
  const schema = pageLinkSelectionSchema.safeExtend({
    selectedIds: z.array(z.enum(params.links.map(({ id }) => id)))
      .max(limit),
  })
  const pageContext = formatBoundedTextEntries([
    {
      opening: `<source>\n${JSON.stringify({ url: params.sourceUrl })}\n`,
      text: params.sourceSummary,
      closing: "\n</source>",
    },
    ...(params.knownPages ?? [])
      .filter(({ url }) => url !== params.sourceUrl)
      .map(({ summary, ...metadata }) => ({
        opening: `<known_page>\n${JSON.stringify(metadata)}\n`,
        text: summary ?? "",
        closing: "\n</known_page>",
      })),
  ], config.deepSearch.maxSummaryContextChars)
  const generation = await generateObjectStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    promptName: PromptName.SelectLinkedPages,
    prompt: [
      "<research_request>", params.userQuery, "</research_request>",
      "<page_context>", pageContext, "</page_context>",
      "<requirements>", JSON.stringify(params.requirements ?? []), "</requirements>",
      `maximum_pages_to_open: ${limit}`,
      "<discovered_links>", JSON.stringify(params.links), "</discovered_links>",
    ].join("\n"),
    schema,
    workflowSignal: params.workflowSignal,
    onRegistered: params.onRegistered,
    onFailed: params.onFailed,
    onInterrupted: params.onInterrupted,
    onCompleted: (completed, transaction) => {
      params.onCompleted?.({ id: completed.id, output: completed.output.selectedIds }, transaction)
    },
  })
  return {
    streamId: generation.id,
    selectedIds: awaitGenerationOutput(generation, generation.output)
      .then(({ selectedIds }) => selectedIds),
    completion: generation.completion,
  }
}

type SelectWebSearchResultsInput = Pick<
  TextGenerationPersistenceCallbacks,
  "onRegistered" | "onFailed" | "onInterrupted"
> & {
  userId: string
  deepSearchJobId: string
  userQuery: string
  searchQuery: string
  results: IndexedSearchResult[]
  maxResultsToExplore?: number
  requirements?: ResearchRequirements
  knownPages?: Array<{ url: string; status: string; title?: string; summary?: string }>
  reviewReason?: string
  workflowSignal?: AbortSignal
  onCompleted?: (
    completed: { id: string; output: string[] },
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

export type SelectionGeneration = {
  streamId: string
  selectedIds: Promise<string[]>
  completion: Promise<GenerationOutcome>
}

function normalizeSelectedIds(
  ids: readonly string[],
  knownIds: ReadonlySet<string>,
  maxResultsToExplore: number,
): string[] {
  // TODO: Reject unknown or duplicate selector IDs at the model boundary.
  // For now they are ignored and do not consume the exploration quota.
  return [...new Set(ids.filter((id) => knownIds.has(id)))].slice(
    0,
    maxResultsToExplore,
  )
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
    "<requirements>", JSON.stringify(params.requirements ?? []), "</requirements>",
    "<known_pages>", JSON.stringify(params.knownPages ?? []), "</known_pages>",
    "<review_findings>", params.reviewReason ?? "", "</review_findings>",
    "<search_results>",
    formattedResults,
    "</search_results>",
  ].join("\n")
  const knownIds = new Set(params.results.map(({ id }) => id))

  const generation = await generateArrayStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.SelectWebSearchResults,
    element: z.string(),
    workflowSignal: params.workflowSignal,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
    ...(params.onInterrupted
      ? { onInterrupted: params.onInterrupted }
      : {}),
    ...(params.onCompleted
      ? {
          onCompleted: (
            completed: { id: string; output: string[] },
            transaction: TextStreamPersistenceTransaction,
          ) => {
            params.onCompleted?.(
              {
                id: completed.id,
                output: normalizeSelectedIds(
                  completed.output,
                  knownIds,
                  maxResultsToExplore,
                ),
              },
              transaction,
            )
          },
        }
      : {}),
  })

  return {
    streamId: generation.id,
    selectedIds: awaitGenerationOutput(
      generation,
      generation.output,
    ).then((ids) =>
      normalizeSelectedIds(ids, knownIds, maxResultsToExplore),
    ),
    completion: generation.completion,
  }
}
