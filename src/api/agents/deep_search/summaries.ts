import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { selectRelevantPassages } from "../../helpers/boundedText.ts"
import {
  calculateScrapingAntCredits,
  requirePositiveCreditBalance,
} from "../../credits.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
} from "../../llms/streams.ts"
import { webExtract, type WebExtractResult } from "../../web_search/webExtract.ts"

const maxPageContentChars = 100_000

type SummarizePageInput = TextGenerationPersistenceCallbacks & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  url: string
  content: string
  workflowSignal?: AbortSignal
}

export type PageSummaryGeneration = {
  streamId: string
  completion: Promise<GenerationOutcome>
}

/**
 * Registers a research-focused page summary and exposes its stream, durable
 * completion, and summary text separately.
 */
export async function summarizePage(
  params: SummarizePageInput,
): Promise<PageSummaryGeneration> {
  const content = selectRelevantPassages(params.content, params.researchRequest, maxPageContentChars)
  const prompt = [
    `user_query: ${params.researchRequest}`,
    `source_url: ${params.url}`,
    "page_content:",
    "<page_content>",
    content,
    "</page_content>",
  ].join("\n")

  const generation = await generateTextStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.SummarizeWebPage,
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
    completion: generation.completion,
  }
}

type StartPageSummaryInput = TextGenerationPersistenceCallbacks & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  url: string
  onExtractionSettled?: (settlement: {
    content: string
    creditsUsed: number
    links: WebExtractResult["links"]
  }) => void
  workflowSignal?: AbortSignal
}

export type PageSummaryStart =
  | {
      status: "failed"
      stage: "extraction" | "summary"
      message: string
    }
  | {
      status: "started"
      streamId: string
      summary: Promise<string | undefined>
      completion: Promise<GenerationOutcome>
    }

type PageExtractionResult =
  | { status: "failed"; message: string }
  | { status: "completed"; content: string; creditsUsed: number; links: WebExtractResult["links"] }

async function extractPage(
  params: Pick<StartPageSummaryInput, "userId" | "url" | "researchRequest" | "workflowSignal">,
): Promise<PageExtractionResult> {
  try {
    requirePositiveCreditBalance(params.userId)
    const page = await webExtract({
      url: params.url,
      signal: params.workflowSignal,
    })
    if (!page.content.trim()) {
      throw new Error("Page extraction returned no content")
    }
    return {
      status: "completed",
      content: page.content,
      creditsUsed: calculateScrapingAntCredits(page.scrapingAntCredits ?? 0),
      links: page.links,
    }
  } catch (error) {
    return {
      status: "failed",
      message: getErrorMessage(error, "Page summary failed"),
    }
  }
}

/**
 * Extracts one selected page and either returns a typed local failure or a
 * summary-generation handle. Event publication belongs to the coordinator.
 */
export async function startPageSummary(
  params: StartPageSummaryInput,
): Promise<PageSummaryStart> {
  const extraction = await extractPage(params)
  if (extraction.status === "failed") {
    return {
      status: "failed",
      stage: "extraction",
      message: extraction.message,
    }
  }
  const content = selectRelevantPassages(extraction.content, params.researchRequest, maxPageContentChars)
  params.onExtractionSettled?.({
    content,
    creditsUsed: extraction.creditsUsed,
    links: extraction.links,
  })

  try {
    const generation = await summarizePage({
      userId: params.userId,
      deepSearchJobId: params.deepSearchJobId,
      researchRequest: params.researchRequest,
      url: params.url,
      content,
      workflowSignal: params.workflowSignal,
      ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
      ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
      ...(params.onFailed ? { onFailed: params.onFailed } : {}),
      ...(params.onInterrupted
        ? { onInterrupted: params.onInterrupted }
        : {}),
    })

    return {
      status: "started",
      streamId: generation.streamId,
      summary: generation.completion.then((outcome) =>
        outcome.status === "completed"
          ? outcome.text.trim() || undefined
          : undefined,
      ),
      completion: generation.completion,
    }
  } catch (error) {
    return {
      status: "failed",
      stage: "summary",
      message: getErrorMessage(error, "Page summary failed"),
    }
  }
}
