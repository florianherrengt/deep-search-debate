import z from "zod"
import { collectStreamText } from "../../helpers/index.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { webExtract } from "../../web_search/webExtract.ts"
import { deepSearchInputSchema } from "./schemas.ts"

/**
 * Registers a research-focused page-summary stream and returns its ID without
 * waiting for generation to finish.
 */
export const summarizePage = z
  .function()
  .input(
    z.tuple([
      z.object({
        researchRequest: z.string().min(1),
        url: z.url(),
        content: z.string().min(1),
      }),
    ]),
  )
  .output(z.string())
  .implementAsync(async (params) => {
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
  })

const startPageSummaryInputSchema = deepSearchInputSchema
  .pick({ researchRequest: true, onEvent: true })
  .extend({ url: z.url() })

type StartPageSummaryInput = z.infer<typeof startPageSummaryInputSchema>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Page summary failed"
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
      message: getErrorMessage(error),
    })
    return undefined
  }
}

/**
 * Extracts one selected page, exposes its summary stream, and returns the completed
 * summary text. Failures return no text so callers can fall back to search snippets.
 */
export const startPageSummary = z
  .function()
  .input(z.tuple([startPageSummaryInputSchema]))
  .output(z.string().optional())
  .implementAsync(async (params) => {
    const content = await extractPageContent(params)
    if (content === undefined) return

    let streamId: string
    try {
      streamId = await summarizePage({
        researchRequest: params.researchRequest,
        url: params.url,
        content,
      })
      params.onEvent({ type: "page-summary-stream", url: params.url, streamId })
    } catch (error) {
      params.onEvent({
        type: "page-summary-error",
        url: params.url,
        stage: "summary",
        message: getErrorMessage(error),
      })
      return
    }

    try {
      const summary = (await collectStreamText({ id: streamId })).trim()
      return summary || undefined
    } catch {
      return undefined
    }
  })
