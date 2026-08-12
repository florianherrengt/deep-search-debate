import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationText,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
} from "../../llms/streams.ts"
import { formatSearchSummaryContext } from "./searchSummaryContext.ts"

type SearchSummary = {
  round?: number
  query: string
  content: string
}

type AnswerResearchRequestInput = TextGenerationPersistenceCallbacks & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  searchSummaries: SearchSummary[]
}

export type FinalAnswerGeneration = {
  streamId: string
  answer: Promise<string>
  completion: Promise<GenerationOutcome>
}

/** Starts a candidate answer that may be promoted as the job's final answer. */
export async function answerResearchRequest(
  params: AnswerResearchRequestInput,
): Promise<FinalAnswerGeneration> {
  const formattedSummaries = formatSearchSummaryContext(params.searchSummaries)

  const prompt = [
    `user_query: ${params.researchRequest}`,
    "search_summaries:",
    "<search_summaries>",
    formattedSummaries,
    "</search_summaries>",
  ].join("\n")

  const generation = await generateTextStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.AnswerResearchRequest,
    // Final synthesis must always leave budget for user-visible text.
    reasoning: "disabled",
    maxOutputTokens: 4_096,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
  })
  return {
    streamId: generation.id,
    answer: awaitGenerationText(generation),
    completion: generation.completion,
  }
}
