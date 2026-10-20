export type PdfTextExtraction = {
  pages: string[]
  totalPages: number
  truncatedBy: "pages" | "text" | null
}

type PdfTextContentChunk = { items: unknown[] }
type PdfPage = {
  cleanup(): void
  streamTextContent(): ReadableStream<PdfTextContentChunk>
}

export type PdfDocument = {
  getPage(pageNumber: number): Promise<PdfPage>
  numPages: number
}

type PdfTextItem = { hasEOL?: boolean; str: string }

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return typeof item === "object" && item !== null && "str" in item &&
    typeof item.str === "string"
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  throw error
}

/** Reads PDF.js text chunks sequentially and cancels at the configured limit. */
export async function extractPdfText(
  document: PdfDocument,
  maxPages: number,
  maxTextChars: number,
  signal?: AbortSignal,
): Promise<PdfTextExtraction> {
  const pages: string[] = []
  const pagesToRead = Math.min(document.numPages, maxPages)
  let remainingChars = maxTextChars
  let truncatedBy: PdfTextExtraction["truncatedBy"] = null

  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
    throwIfAborted(signal)
    const page = await document.getPage(pageNumber)
    try {
      const reader = page.streamTextContent().getReader()
      const textParts: string[] = []
      let limitReached = false
      try {
        while (!limitReached) {
          throwIfAborted(signal)
          const chunk = await reader.read()
          throwIfAborted(signal)
          if (chunk.done) break

          for (const item of chunk.value.items) {
            if (!isPdfTextItem(item)) continue
            const itemText = item.str + (item.hasEOL ? "\n" : "")
            const acceptedText = itemText.slice(0, remainingChars)
            textParts.push(acceptedText)
            remainingChars -= acceptedText.length
            if (remainingChars === 0) {
              limitReached = true
              break
            }
          }
        }
      } finally {
        if (limitReached) await reader.cancel()
        reader.releaseLock()
      }

      pages.push(textParts.join(""))
      if (limitReached) {
        truncatedBy = "text"
        break
      }
    } finally {
      page.cleanup()
    }
  }

  return {
    pages,
    totalPages: document.numPages,
    truncatedBy: truncatedBy ?? (document.numPages > pagesToRead ? "pages" : null),
  }
}
