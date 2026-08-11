import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  generateTextStream: vi.fn(),
  webExtract: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../../web_search/webExtract.ts", () => ({
  webExtract: mocks.webExtract,
}))

import { startPageSummary, summarizePage } from "./summaries.ts"

function completedGeneration(
  id = "summary-stream-id",
  text = "Completed page summary",
) {
  return {
    id,
    completion: Promise.resolve({
      status: "completed" as const,
      text,
      reasoning: "",
    }),
  }
}

describe("page summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.webExtract.mockResolvedValue({
      url: "https://example.com/page",
      content: "Extracted page content",
    })
  })

  it("registers a research-focused summary stream", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    const result = await summarizePage({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research OpenAI products",
      url: "https://example.com/page",
      content: "Extracted page content",
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
      reasoning: "disabled",
      maxOutputTokens: 2_048,
    })
    expect(result.streamId).toBe("summary-stream-id")
    await expect(result.completion).resolves.toMatchObject({
      status: "completed",
      text: "Completed page summary",
    })
  })

  it("bounds extracted content before sending it to the model", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())
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

  it("extracts a page and returns its registered summary handle", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })

    expect(result.status).toBe("started")
    if (result.status !== "started") throw new Error("Summary did not start")
    expect(result.streamId).toBe("summary-stream-id")
    await expect(result.summary).resolves.toBe("Completed page summary")
  })

  it("returns extraction failures without starting a summary stream", async () => {
    mocks.webExtract.mockRejectedValueOnce(new Error("Extraction failed"))

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })

    expect(result).toEqual({
      status: "failed",
      stage: "extraction",
      message: "Extraction failed",
    })
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
  })

  it("isolates one page retrieval failure while another page remains usable", async () => {
    mocks.webExtract.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith("/failed")) {
        return Promise.reject(new Error("All retrieval tiers failed"))
      }
      return Promise.resolve({
        url,
        content: "Usable content from the other page",
      })
    })
    mocks.generateTextStream.mockResolvedValueOnce(
      completedGeneration("usable-stream-id"),
    )

    const results = await Promise.all([
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/usable",
      }),
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        url: "https://example.com/failed",
      }),
    ])

    const [usable, failed] = results
    expect(usable?.status).toBe("started")
    if (usable?.status !== "started") throw new Error("Summary did not start")
    expect(usable.streamId).toBe("usable-stream-id")
    await expect(usable.summary).resolves.toBe("Completed page summary")
    expect(failed).toEqual({
      status: "failed",
      stage: "extraction",
      message: "All retrieval tiers failed",
    })
  })

  it("returns summary stream registration failures separately", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })

    expect(result).toEqual({
      status: "failed",
      stage: "summary",
      message: "Stream registration failed",
    })
  })

  it("returns no summary when the registered stream fails", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({
      id: "summary-stream-id",
      completion: Promise.resolve({
        status: "failed",
        text: "",
        reasoning: "",
        error: "Summary generation failed",
      }),
    })

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })
    expect(result.status).toBe("started")
    if (result.status !== "started") throw new Error("Summary did not start")
    expect(result.streamId).toBe("summary-stream-id")
    await expect(result.summary).resolves.toBeUndefined()
  })

  it("does not hide terminal persistence failures as snippet fallback", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({
      id: "summary-stream-id",
      completion: Promise.reject(new Error("SQLite unavailable")),
    })

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })
    expect(result.status).toBe("started")
    if (result.status !== "started") throw new Error("Summary did not start")
    await expect(result.summary).rejects.toThrow("SQLite unavailable")
  })
})
