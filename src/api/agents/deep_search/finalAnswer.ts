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
import type { ResearchRequirements } from "./schemas.ts"

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
  sourceEvidence?: SourceEvidence[]
  requirements?: ResearchRequirements
  candidateAnswer?: string
  reviewReason?: string
  workflowSignal?: AbortSignal
}

export type FinalAnswerGeneration = {
  streamId: string
  answer: Promise<string>
  completion: Promise<GenerationOutcome>
}

/** Starts a candidate or, when supplied a candidate, its final source-backed correction. */
export async function answerResearchRequest(
  params: AnswerResearchRequestInput,
): Promise<FinalAnswerGeneration> {
  const formattedSummaries = formatSearchSummaryContext(
    params.searchSummaries,
    undefined,
    params.sourceEvidence,
    params.researchRequest,
  )

  const prompt = [
    `user_query: ${params.researchRequest}`,
    "<requirements>", JSON.stringify(params.requirements ?? []), "</requirements>",
    ...(params.candidateAnswer === undefined ? [] : [
      "<candidate_answer>", params.candidateAnswer, "</candidate_answer>",
      "<review_findings>", params.reviewReason ?? "No separate review findings are available; check the source passages directly.", "</review_findings>",
    ]),
    "search_summaries:",
    "<search_summaries>",
    formattedSummaries,
    "</search_summaries>",
  ].join("\n")

  const generation = await generateTextStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: params.candidateAnswer === undefined ? PromptName.AnswerResearchRequest : PromptName.CorrectResearchAnswer,
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
    answer: awaitGenerationText(generation),
    completion: generation.completion,
  }
}
