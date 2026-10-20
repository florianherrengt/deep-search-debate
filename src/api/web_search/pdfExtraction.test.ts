import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractPdfInProcess: vi.fn(),
}))

vi.mock("./pdfProcessClient.ts", () => ({
  extractPdfInProcess: mocks.extractPdfInProcess,
}))

import { PdfExtractor } from "./pdfExtraction.ts"

function pdfResponse(bytes = new TextEncoder().encode("%PDF-1.7 document"), headers: HeadersInit = {}) {
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", ...headers },
  })
}

describe("PdfExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extractPdfInProcess.mockResolvedValue({
      pages: ["Useful extracted evidence"],
      totalPages: 1,
      truncatedBy: null,
    })
  })

  it("does not read or parse a download that declares more than the byte limit", async () => {
    const fetch = vi.fn(() => Promise.resolve(pdfResponse(undefined, { "content-length": "33" })))
    const extractor = new PdfExtractor({ maxBytes: 32 })

    await expect(extractor.extract({
      url: new URL("https://example.com/report.pdf"),
      fetch,
    })).resolves.toBeNull()
    expect(mocks.extractPdfInProcess).not.toHaveBeenCalled()
  })

  it("reports when parsed content stops at the configured page and text limits", async () => {
    const extractor = new PdfExtractor({ maxPages: 1, maxTextChars: 12 })
    mocks.extractPdfInProcess.mockResolvedValueOnce({
      pages: ["Useful text"],
      totalPages: 4,
      truncatedBy: "pages",
    })

    await expect(extractor.extract({
      url: new URL("https://example.com/report.pdf"),
      fetch: () => Promise.resolve(pdfResponse()),
    })).resolves.toEqual({
      content: "# PDF document\n\nPages: 4\n\n## Page 1\n\nUseful text",
      warnings: ["PDF extraction stopped after 1 of 4 pages."],
    })
    expect(mocks.extractPdfInProcess).toHaveBeenCalledWith(expect.objectContaining({
      maxPages: 1,
      maxTextChars: 12,
    }))
  })

  it("starts the parser deadline after the fetch deadline has ended", async () => {
    vi.useFakeTimers()
    try {
      let markParserStarted: (() => void) | undefined
      const parserStarted = new Promise<void>((resolve) => { markParserStarted = resolve })
      let finishParsing: (() => void) | undefined
      mocks.extractPdfInProcess.mockImplementationOnce(({
        signal,
      }: { signal?: AbortSignal }) => {
        markParserStarted?.()
        return new Promise((resolve, reject) => {
          if (signal?.aborted) {
            const error = new Error("The operation was aborted")
            error.name = "AbortError"
            reject(error)
            return
          }
          signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted")
            error.name = "AbortError"
            reject(error)
          }, { once: true })
          finishParsing = () => resolve({
            pages: ["Useful extracted evidence"],
            totalPages: 1,
            truncatedBy: null,
          })
        })
      })

      const pending = new PdfExtractor({ timeoutMs: 10, parseTimeoutMs: 100 }).extract({
        url: new URL("https://example.com/report.pdf"),
        fetch: () => Promise.resolve(pdfResponse()),
      })
      await parserStarted
      await vi.advanceTimersByTimeAsync(20)
      finishParsing?.()

      await expect(pending).resolves.toEqual({
        content: "# PDF document\n\nPages: 1\n\n## Page 1\n\nUseful extracted evidence",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("propagates caller cancellation while the download is pending", async () => {
    const controller = new AbortController()
    let observeAbort: (() => void) | undefined
    const fetch = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      observeAbort = () => {
        const error = new Error("The operation was aborted")
        error.name = "AbortError"
        reject(error)
      }
    }))
    const pending = new PdfExtractor().extract({
      url: new URL("https://example.com/report.pdf"),
      fetch,
      signal: controller.signal,
    })

    controller.abort()
    observeAbort?.()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(mocks.extractPdfInProcess).not.toHaveBeenCalled()
  })
})
