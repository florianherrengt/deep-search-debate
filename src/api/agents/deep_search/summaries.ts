import { collectStreamText } from "../../helpers/index.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { webExtract } from "../../web_search/webExtract.ts"
import type { DeepSearchEvent } from "./schemas.ts"

type SummarizePageInput = {
  researchRequest: string
  url: string
  content: string
}

/**
 * Registers a research-focused page-summary stream and returns its ID without
 * waiting for generation to finish.
 */
export async function summarizePage(
  params: SummarizePageInput,
): Promise<string> {
  const prompt = [
    `user_query: ${params.researchRequest}`,
    `source_url: ${params.url}`,
    "page_content:",
    "<page_content>",
    params.content,
    "</page_content>",
  ].join("\n")

  const { id } = await generateTextStream({
    prompt,
    promptName: PromptName.SummarizeWebPage,
  })
  return id
}

type StartPageSummaryInput = {
  researchRequest: string
  url: string
  onEvent: (event: DeepSearchEvent) => void
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
