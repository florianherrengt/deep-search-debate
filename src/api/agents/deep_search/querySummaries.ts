import { generateTextStream } from "../../llms/generateText.ts"
import { config } from "../../config.ts"
import { formatBoundedTextEntries } from "../../helpers/boundedText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationText,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
} from "../../llms/streams.ts"

type QuerySummaryResult = {
  title: string
  url: string
  content: string
}

type SummarizeSearchQueryInput = TextGenerationPersistenceCallbacks & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  query: string
  results: QuerySummaryResult[]
}

export type QuerySummaryGeneration = {
  streamId: string
  summary: Promise<string>
  completion: Promise<GenerationOutcome>
}

/** Starts top-level synthesis for all content returned by one web search. */
export async function summarizeSearchQuery(
  params: SummarizeSearchQueryInput,
): Promise<QuerySummaryGeneration> {
  const formattedResults = formatBoundedTextEntries(
    params.results.map((result) => ({
      opening: "<result>\n",
      text: JSON.stringify(result),
      closing: "\n</result>",
    })),
    config.deepSearch.maxSummaryContextChars,
  )

  const prompt = [
    `user_query: ${params.researchRequest}`,
    `search_query: ${params.query}`,
    "results:",
    "<results>",
    formattedResults,
    "</results>",
  ].join("\n")

  const generation = await generateTextStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.SummarizeSearchQuery,
    // Reserve the bounded output for the durable synthesis rather than hidden
    // reasoning; DeepSeek counts both against maxOutputTokens.
    reasoning: "disabled",
    maxOutputTokens: 2_048,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
  })
  return {
    streamId: generation.id,
    summary: awaitGenerationText(generation),
    completion: generation.completion,
  }
}
