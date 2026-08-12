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
import {
  webExtract,
} from "../../web_search/webExtract.ts"

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
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
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
  onExtractionSettled?: (creditsUsed: number) => void
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

/**
 * Extracts one selected page and either returns a typed local failure or a
 * summary-generation handle. Event publication belongs to the coordinator.
 */
export async function startPageSummary(
  params: StartPageSummaryInput,
): Promise<PageSummaryStart> {
  let content: string
  let extractionCreditsUsed = 0
  try {
    requirePositiveCreditBalance(params.userId)
    const page = await webExtract({ url: params.url })
    extractionCreditsUsed = calculateScrapingAntCredits(
      page.scrapingAntCredits ?? 0,
    )
    if (!page.content.trim()) {
      throw new Error("Page extraction returned no content")
    }
    content = page.content
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "WebExtractionError" &&
      "scrapingAntCredits" in error &&
      typeof error.scrapingAntCredits === "number"
    ) {
      extractionCreditsUsed = calculateScrapingAntCredits(
        error.scrapingAntCredits,
      )
    }
    params.onExtractionSettled?.(extractionCreditsUsed)
    return {
      status: "failed",
      stage: "extraction",
      message: getErrorMessage(error, "Page summary failed"),
    }
  }
  params.onExtractionSettled?.(extractionCreditsUsed)

  let generation: PageSummaryGeneration
  try {
    generation = await summarizePage({
      userId: params.userId,
      deepSearchJobId: params.deepSearchJobId,
      researchRequest: params.researchRequest,
      url: params.url,
      content,
      ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
      ...(params.onCompleted ? { onCompleted: params.onCompleted } : {}),
      ...(params.onFailed ? { onFailed: params.onFailed } : {}),
    })
  } catch (error) {
    return {
      status: "failed",
      stage: "summary",
      message: getErrorMessage(error, "Page summary failed"),
    }
  }

  return {
    status: "started",
    streamId: generation.streamId,
    summary: generation.completion.then((outcome) =>
      outcome.status === "failed" ? undefined : outcome.text.trim() || undefined,
    ),
    completion: generation.completion,
  }
}
