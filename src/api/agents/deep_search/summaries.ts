import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
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
import { webExtract } from "../../web_search/webExtract.ts"

const maxPageContentChars = 100_000
const pageContentOmission =
  "\n\n[... page content omitted to fit the model context ...]\n\n"

/** Keeps page-summary requests bounded while preserving introductions and conclusions. */
function fitPageContent(content: string): string {
  if (content.length <= maxPageContentChars) return content

  const availableChars = maxPageContentChars - pageContentOmission.length
  const startChars = Math.ceil(availableChars * 0.75)
  const endChars = availableChars - startChars
  return [
    content.slice(0, startChars),
    pageContentOmission,
    content.slice(-endChars),
  ].join("")
}

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
  const content = fitPageContent(params.content)
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
    // This stage transforms supplied evidence. Hidden reasoning competes with
    // the summary for the same provider output budget and can consume it all.
    reasoning: "disabled",
    maxOutputTokens: 2_048,
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
  | { status: "completed"; content: string; creditsUsed: number }

async function extractPage(
  params: Pick<StartPageSummaryInput, "userId" | "url" | "workflowSignal">,
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
  const content = fitPageContent(extraction.content)
  params.onExtractionSettled?.({
    content,
    creditsUsed: extraction.creditsUsed,
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
