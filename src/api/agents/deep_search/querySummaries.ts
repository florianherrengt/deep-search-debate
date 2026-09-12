import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationText,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
} from "../../llms/streams.ts"
import {
  formatSearchSummaryContext,
  type SourceEvidence,
} from "./searchSummaryContext.ts"

type SummarizeSearchQueryInput = TextGenerationPersistenceCallbacks & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  query: string
  results: SourceEvidence[]
  workflowSignal?: AbortSignal
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
  const formattedResults = formatSearchSummaryContext(
    [],
    undefined,
    params.results,
    params.researchRequest,
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
    reasoning: "disabled",
    workflowSignal: params.workflowSignal,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
    ...(params.onInterrupted
      ? { onInterrupted: params.onInterrupted }
      : {}),
  })
  return {
    streamId: generation.id,
    summary: awaitGenerationText(generation),
    completion: generation.completion,
  }
}
