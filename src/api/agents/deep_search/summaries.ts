import { collectStreamText } from "../../helpers/index.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { webExtract } from "../../web_search/webExtract.ts"
import type { DeepSearchEvent } from "./schemas.ts"

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

type SummarizePageInput = {
  researchRequest: string
  url: string
  content: string
  maxRetries?: number
}

/**
 * Registers a research-focused page-summary stream and returns its ID without
 * waiting for generation to finish.
 */
export async function summarizePage(
  params: SummarizePageInput,
): Promise<string> {
  const content = fitPageContent(params.content)
  const prompt = [
    `user_query: ${params.researchRequest}`,
    `source_url: ${params.url}`,
    "page_content:",
    "<page_content>",
    content,
    "</page_content>",
  ].join("\n")

  const { id } = await generateTextStream({
    prompt,
    promptName: PromptName.SummarizeWebPage,
    maxRetries: params.maxRetries,
  })
  return id
}

type StartPageSummaryInput = {
  researchRequest: string
  url: string
  onEvent: (event: DeepSearchEvent) => void
  maxRetries?: number
}

/** Extracts validated page content and reports extraction failures in place. */
async function extractPageContent(
  params: StartPageSummaryInput,
): Promise<string | undefined> {
  try {
    const page = await webExtract({ url: params.url })
    if (!page.content.trim()) {
      throw new Error("Page extraction returned no content")
    }
    return page.content
  } catch (error) {
    params.onEvent({
      type: "page-summary-error",
      url: params.url,
      stage: "extraction",
      message: getErrorMessage(error, "Page summary failed"),
    })
    return undefined
  }
}

async function createPageSummaryStream(
  params: StartPageSummaryInput,
  content: string,
): Promise<string | undefined> {
  try {
    const streamId = await summarizePage({
      researchRequest: params.researchRequest,
      url: params.url,
      content,
      maxRetries: params.maxRetries,
    })
    params.onEvent({ type: "page-summary-stream", url: params.url, streamId })
    return streamId
  } catch (error) {
    params.onEvent({
      type: "page-summary-error",
      url: params.url,
      stage: "summary",
      message: getErrorMessage(error, "Page summary failed"),
    })
    return undefined
  }
}

/**
 * Extracts one selected page, exposes its summary stream, and returns the completed
 * summary text. Failures return no text so callers can fall back to search snippets.
 */
export async function startPageSummary(
  params: StartPageSummaryInput,
): Promise<string | undefined> {
  const content = await extractPageContent(params)
  if (content === undefined) return

  const streamId = await createPageSummaryStream(params, content)
  if (streamId === undefined) return

  try {
    const summary = (await collectStreamText({ id: streamId })).trim()
    return summary || undefined
  } catch {
    return undefined
  }
}
