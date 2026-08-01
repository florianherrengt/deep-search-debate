import { beforeEach, describe, expect, it, vi } from "vitest"

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
      researchRequest: "Research OpenAI products",
      url: "https://example.com/page",
      content: "Extracted page content",
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      prompt: [
        "user_query: Research OpenAI products",
        "source_url: https://example.com/page",
        "page_content:",
        "<page_content>",
        "Extracted page content",
        "</page_content>",
      ].join("\n"),
      promptName: "summarize-web-page",
    })
    expect(result).toBe("summary-stream-id")
  })

  it("propagates summary stream registration failures", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await expect(
      summarizePage({
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

  it("reports summary stream registration failures separately", async () => {
    const onEvent = vi.fn()
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await startPageSummary({
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
