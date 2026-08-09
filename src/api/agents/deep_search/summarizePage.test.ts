import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  collectStreamText: vi.fn(),
  generateTextStream: vi.fn(),
  webExtract: vi.fn(),
}))

vi.mock("../../helpers/index.ts", () => ({
  collectStreamText: mocks.collectStreamText,
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../../web_search/webExtract.ts", () => ({
  webExtract: mocks.webExtract,
}))

import { startPageSummary, summarizePage } from "./summaries.ts"

describe("page summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.webExtract.mockResolvedValue({
      url: "https://example.com/page",
      content: "Extracted page content",
    })
    mocks.collectStreamText.mockResolvedValue("Completed page summary")
  })

  it("registers a research-focused summary stream", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "summary-stream-id" })

    const result = await summarizePage({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research OpenAI products",
      url: "https://example.com/page",
      content: "Extracted page content",
      maxRetries: 0,
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "user_query: Research OpenAI products",
        "source_url: https://example.com/page",
        "page_content:",
        "<page_content>",
        "Extracted page content",
        "</page_content>",
      ].join("\n"),
      promptName: "summarize-web-page",
      maxRetries: 0,
    })
    expect(result).toBe("summary-stream-id")
  })

  it("bounds extracted content before sending it to the model", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({ id: "summary-stream-id" })
    const content = `document-start-${"x".repeat(150_000)}-document-end`

    await summarizePage({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research a long document",
      url: "https://example.com/report.pdf",
      content,
    })

    const { prompt } = z.object({ prompt: z.string() }).parse(
      mocks.generateTextStream.mock.calls[0]?.[0] as unknown,
    )
    expect(prompt).toContain("document-start")
    expect(prompt).toContain("document-end")
    expect(prompt).toContain("[... page content omitted to fit the model context ...]")
    expect(prompt).not.toContain(content)
    expect(prompt.length).toBeLessThan(102_000)
  })

  it("propagates summary stream registration failures", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await expect(
      summarizePage({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/page",
        content: "Extracted page content",
      }),
    ).rejects.toThrow("Stream registration failed")
  })

  it("extracts a page and emits its registered summary stream", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "summary-stream-id" })

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-stream",
      url: "https://example.com/page",
      streamId: "summary-stream-id",
    })
    expect(mocks.collectStreamText).toHaveBeenCalledWith({
      id: "summary-stream-id",
    })
    expect(result).toBe("Completed page summary")
  })

  it("emits extraction failures without starting a summary stream", async () => {
    const onEvent = vi.fn()
    mocks.webExtract.mockRejectedValueOnce(new Error("Extraction failed"))

    await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-error",
      url: "https://example.com/page",
      stage: "extraction",
      message: "Extraction failed",
    })
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
    expect(mocks.collectStreamText).not.toHaveBeenCalled()
  })

  it("isolates one page retrieval failure while another page remains usable", async () => {
    const onEvent = vi.fn()
    mocks.webExtract.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith("/failed")) {
        return Promise.reject(new Error("All retrieval tiers failed"))
      }
      return Promise.resolve({
        url,
        content: "Usable content from the other page",
      })
    })
    mocks.generateTextStream.mockResolvedValueOnce({ id: "usable-stream-id" })

    const results = await Promise.all([
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/usable",
        onEvent,
      }),
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/failed",
        onEvent,
      }),
    ])

    expect(results).toEqual(["Completed page summary", undefined])
    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-stream",
      url: "https://example.com/usable",
      streamId: "usable-stream-id",
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-error",
      url: "https://example.com/failed",
      stage: "extraction",
      message: "All retrieval tiers failed",
    })
  })

  it("reports summary stream registration failures separately", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-error",
      url: "https://example.com/page",
      stage: "summary",
      message: "Stream registration failed",
    })
    expect(mocks.collectStreamText).not.toHaveBeenCalled()
  })

  it("returns no summary when the registered stream fails", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockResolvedValueOnce({ id: "summary-stream-id" })
    mocks.collectStreamText.mockRejectedValueOnce(
      new Error("Summary generation failed"),
    )

    await expect(
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/page",
        onEvent,
      }),
    ).resolves.toBeUndefined()

    expect(onEvent).toHaveBeenCalledWith({
      type: "page-summary-stream",
      url: "https://example.com/page",
      streamId: "summary-stream-id",
    })
  })
})
