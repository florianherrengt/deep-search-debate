import { generateObjectStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import {
  researchAnalysisSchema,
  type ResearchAnalysis,
  type ResearchRequirements,
} from "./schemas.ts"
import {
  formatSearchSummaryContext,
  type SourceEvidence,
} from "./searchSummaryContext.ts"

type SearchSummary = {
  round: number
  query: string
  content: string
}

type AnalyzeResearchAnswerInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  finalAnswer: string
  searchSummaries: SearchSummary[]
  sourceEvidence?: SourceEvidence[]
  requirements?: ResearchRequirements
  workflowSignal?: AbortSignal
  onCompleted?: (
    completed: { id: string; output: ResearchAnalysis },
    transaction: TextStreamPersistenceTransaction,
  ) => void
  onRegistered?: (
    id: string,
    transaction: TextStreamPersistenceTransaction,
  ) => void
  onFailed?: TextGenerationPersistenceCallbacks["onFailed"]
  onInterrupted?: TextGenerationPersistenceCallbacks["onInterrupted"]
}

export type ResearchAnalysisGeneration = {
  generationId: string
  analysis: Promise<ResearchAnalysis>
  completion: Promise<GenerationOutcome>
}

/** Starts the separate structured analysis of an accepted research answer. */
export async function analyzeResearchAnswer(
  input: AnalyzeResearchAnswerInput,
): Promise<ResearchAnalysisGeneration> {
  const summaries = formatSearchSummaryContext(
    input.searchSummaries,
    undefined,
    input.sourceEvidence,
    input.researchRequest,
  )
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { deepSearchJobId: input.deepSearchJobId },
    prompt: [
      "<research_request>",
      input.researchRequest,
      "</research_request>",
      "<requirements>", JSON.stringify(input.requirements ?? []), "</requirements>",
      "<final_answer>",
      input.finalAnswer,
      "</final_answer>",
      "<search_summaries>",
      summaries,
      "</search_summaries>",
    ].join("\n"),
    promptName: PromptName.AnalyzeResearchAnswer,
    schema: researchAnalysisSchema.required({ requirements: true }),
    reasoning: "disabled",
    workflowSignal: input.workflowSignal,
    ...(input.onRegistered ? { onRegistered: input.onRegistered } : {}),
    ...(input.onCompleted ? { onCompleted: input.onCompleted } : {}),
    ...(input.onFailed ? { onFailed: input.onFailed } : {}),
    ...(input.onInterrupted
      ? { onInterrupted: input.onInterrupted }
      : {}),
  })

  return {
    generationId: generation.id,
    analysis: awaitGenerationOutput(generation, generation.output),
    completion: generation.completion,
  }
}
