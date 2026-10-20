import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  generateTextStream: vi.fn(),
  webExtract: vi.fn(),
  installCaptchaHooks: vi.fn(),
  recoverBrowserPage: vi.fn(),
  WebExtractionError: class extends Error {
    constructor(message: string, readonly observedLinks: Array<{ url: string; title: string }>) {
      super(message)
    }
  },
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../../web_search/webExtract.ts", () => ({
  webExtract: mocks.webExtract,
  WebExtractionError: mocks.WebExtractionError,
}))

vi.mock("./browserAgent.ts", () => ({
  installCaptchaHooks: mocks.installCaptchaHooks,
  recoverBrowserPage: mocks.recoverBrowserPage,
}))

import { db } from "../../db/index.ts"
import { user } from "../../db/schema/index.ts"
import { startPageSummary, summarizePage } from "./summaries.ts"

const userId = "test-user-id"
const originalCredits = db
  .select({ credits: user.credits })
  .from(user)
  .where(eq(user.id, userId))
  .get()!.credits

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
    db.update(user).set({ credits: originalCredits }).where(eq(user.id, userId)).run()
    vi.clearAllMocks()
    mocks.webExtract.mockResolvedValue({
      url: "https://example.com/page",
      content: "Extracted page content",
      links: [],
      retrievalMethod: "http",
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
    })
    expect(result.streamId).toBe("summary-stream-id")
    await expect(result.completion).resolves.toMatchObject({
      status: "completed",
      text: "Completed page summary",
    })
  })

  it("bounds extracted content while retaining a query-relevant middle qualification", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())
    const qualification = "Trial eligibility excludes existing customers from the £14 offer."
    const content = `${"Background publication information. ".repeat(4_000)}${qualification}${"General organization history. ".repeat(4_000)}`

    await summarizePage({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research trial eligibility and exclusions",
      url: "https://example.com/report.pdf",
      content,
    })

    const { prompt } = z.object({ prompt: z.string() }).parse(
      mocks.generateTextStream.mock.calls[0]?.[0] as unknown,
    )
    const suppliedContent = /<page_content>\n([\s\S]*?)\n<\/page_content>/.exec(prompt)![1]
    expect(suppliedContent).toContain(qualification)
    expect(suppliedContent.length).toBeLessThanOrEqual(100_000)
    expect(suppliedContent).toContain("[... omitted ...]")
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

  it("extracts and summarizes a page with zero credits remaining", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())
    db.update(user).set({ credits: 0 }).where(eq(user.id, userId)).run()
    const links = [{ url: "https://example.com/terms", title: "Eligibility terms" }]
    mocks.webExtract.mockResolvedValueOnce({
      url: "https://example.com/page",
      content: "Extracted page content",
      links,
      retrievalMethod: "browserless",
    })
    const onExtractionSettled = vi.fn()

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      pageId: "page-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
      onExtractionSettled,
    })

    expect(result.status).toBe("started")
    if (result.status !== "started") throw new Error("Summary did not start")
    expect(result.streamId).toBe("summary-stream-id")
    await expect(result.summary).resolves.toBe("Completed page summary")
    expect(onExtractionSettled).toHaveBeenCalledWith({
      content: "Extracted page content",
      creditsUsed: 0,
      links,
    })
    expect(db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits).toBe(0)
  })

  it("wires CAPTCHA recovery with the selected page identity without making solver calls", async () => {
    const pageUrl = "https://example.com/protected"
    const page = { url: () => pageUrl }
    const controller = new AbortController()
    mocks.recoverBrowserPage.mockResolvedValueOnce({
      html: "<html><body>Recovered</body></html>",
      links: [],
      status: "extracted",
    })
    mocks.webExtract.mockImplementationOnce(async (params: {
      signal?: AbortSignal
      browserRecovery: {
        prepare: (page: unknown, signal: AbortSignal) => Promise<void>
        recover: (page: unknown, signal: AbortSignal) => Promise<unknown>
      }
    }) => {
      await params.browserRecovery.prepare(page, controller.signal)
      await params.browserRecovery.recover(page, controller.signal)
      return {
        url: pageUrl,
        content: "Recovered page evidence",
        links: [],
        retrievalMethod: "browserless" as const,
      }
    })
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "root-job-id",
      pageId: "selected-page-id",
      researchRequest: "Research the protected document",
      url: pageUrl,
      workflowSignal: controller.signal,
    })

    expect(result.status).toBe("started")
    expect(mocks.installCaptchaHooks).toHaveBeenCalledWith(page, controller.signal)
    expect(mocks.recoverBrowserPage).toHaveBeenCalledExactlyOnceWith({
      page,
      signal: controller.signal,
      userId: "test-user-id",
      deepSearchJobId: "root-job-id",
      pageId: "selected-page-id",
      url: pageUrl,
      researchRequest: "Research the protected document",
    })
  })

  it("returns extraction failures without starting a summary stream or charging credits", async () => {
    const error = new Error("Extraction failed")
    mocks.webExtract.mockRejectedValueOnce(error)
    const onExtractionSettled = vi.fn()

    const result = await startPageSummary({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      pageId: "page-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
      onExtractionSettled,
    })

    expect(result).toEqual({
      status: "failed",
      stage: "extraction",
      message: "Extraction failed",
    })
    expect(onExtractionSettled).not.toHaveBeenCalled()
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
  })

  it("returns observed links and the fixed browser recovery reason on extraction failure", async () => {
    const links = [{ url: "https://example.com/next", title: "Next source" }]
    mocks.webExtract.mockRejectedValueOnce(new mocks.WebExtractionError(
      "No retrieval method returned usable content (link-handed-off)", links,
    ))
    const result = await startPageSummary({
      userId, deepSearchJobId: "deep-search-job-id", pageId: "page-id",
      researchRequest: "Research this", url: "https://example.com/page",
    })
    expect(result).toEqual({
      status: "failed", stage: "extraction",
      message: "No retrieval method returned usable content (link-handed-off)", links,
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
        links: [],
        retrievalMethod: "http" as const,
      })
    })
    mocks.generateTextStream.mockResolvedValueOnce(
      completedGeneration("usable-stream-id"),
    )

    const results = await Promise.all([
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        pageId: "usable-page-id",
        researchRequest: "Research this",
        url: "https://example.com/usable",
      }),
      startPageSummary({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        pageId: "failed-page-id",
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
      pageId: "page-id",
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
      pageId: "page-id",
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
      pageId: "page-id",
      researchRequest: "Research this",
      url: "https://example.com/page",
    })
    expect(result.status).toBe("started")
    if (result.status !== "started") throw new Error("Summary did not start")
    await expect(result.summary).rejects.toThrow("SQLite unavailable")
  })
})
