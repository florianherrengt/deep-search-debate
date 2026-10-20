import { describe, expect, it, vi } from "vitest"
import { extractPdfText, type PdfDocument } from "./pdfText.ts"

function documentWithPages(texts: string[]) {
  const getPage = vi.fn((pageNumber: number) => Promise.resolve({
    cleanup: vi.fn(),
    streamTextContent: () => new ReadableStream({
      start(controller) {
        controller.enqueue({ items: [{ str: texts[pageNumber - 1] ?? "" }] })
        controller.close()
      },
    }),
  }))
  return { getPage, numPages: texts.length } satisfies PdfDocument
}

describe("extractPdfText", () => {
  it("stops at the page limit and reports that the document was truncated", async () => {
    const document = documentWithPages(["First page", "Second page", "Third page"])

    await expect(extractPdfText(document, 2, 1_000)).resolves.toEqual({
      pages: ["First page", "Second page"],
      totalPages: 3,
      truncatedBy: "pages",
    })
    expect(document.getPage).toHaveBeenCalledTimes(2)
  })

  it("stops at the text limit without reading later pages", async () => {
    const document = documentWithPages(["abcdefgh", "unread page"])

    await expect(extractPdfText(document, 10, 5)).resolves.toEqual({
      pages: ["abcde"],
      totalPages: 2,
      truncatedBy: "text",
    })
    expect(document.getPage).toHaveBeenCalledTimes(1)
  })

  it("cancels a page text stream as soon as the character budget is reached", async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const read = vi.fn()
      .mockResolvedValueOnce({
        done: false,
        value: { items: [{ str: "abc" }, { str: "def" }] },
      })
      .mockResolvedValueOnce({ done: false, value: { items: [{ str: "unread" }] } })
    const releaseLock = vi.fn()
    const page = {
      cleanup: vi.fn(),
      streamTextContent: () => ({ getReader: () => ({ cancel, read, releaseLock }) }) as unknown as ReadableStream,
    }
    const document = {
      getPage: vi.fn(() => Promise.resolve(page)),
      numPages: 1,
    } satisfies PdfDocument

    await expect(extractPdfText(document, 1, 5)).resolves.toMatchObject({
      pages: ["abcde"],
      truncatedBy: "text",
    })
    expect(read).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()
    expect(page.cleanup).toHaveBeenCalledOnce()
  })
})
