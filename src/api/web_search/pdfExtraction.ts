import PQueue from "p-queue"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { extractPdfInProcess } from "./pdfProcessClient.ts"
import { throwIfAborted } from "./pdfText.ts"
import { validateUrl } from "./urlValidation.ts"
import type { PdfTextExtraction } from "./pdfText.ts"

const DEFAULT_MAX_PDF_BYTES = 20_000_000
const DEFAULT_MAX_PDF_PAGES = 250
const DEFAULT_MAX_PDF_TEXT_CHARS = 250_000
const DEFAULT_PDF_FETCH_TIMEOUT_MS = 30_000
const DEFAULT_PDF_PARSE_TIMEOUT_MS = 30_000
const MAX_PDF_PAGES = 1_000
const MAX_PDF_TEXT_CHARS = 1_000_000
const MAX_PDF_BYTES = 20_000_000
const MAX_PDF_FETCH_TIMEOUT_MS = 600_000

const pdfExtractionQueue = new PQueue({ concurrency: 1 })

export interface PdfExtractorConfig {
  maxBytes?: number
  maxPages?: number
  maxTextChars?: number
  parseTimeoutMs?: number
  timeoutMs?: number
}

export type PdfExtractorInput = {
  url: URL
  fetch: () => Promise<Response>
  signal?: AbortSignal
}

export type PdfExtractorResult = { content: string; warnings?: string[] }

function isPdfBytes(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1_024)).includes("%PDF-")
}

function normalizePageText(text: string): string {
  return text
    .replaceAll(String.fromCharCode(0), "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function formatPdfText(pages: string[], totalPages: number): string | null {
  const sections = pages.flatMap((page, index) => {
    const text = normalizePageText(page)
    return text ? [`## Page ${index + 1}\n\n${text}`] : []
  })
  return sections.length === 0
    ? null
    : ["# PDF document", `Pages: ${totalPages}`, ...sections].join("\n\n")
}

function requireIntegerInRange(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

async function readBytes(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  if (!response.body) {
    const buffer = signal
      ? await waitForAbort(response.arrayBuffer(), signal)
      : await response.arrayBuffer()
    return buffer.byteLength <= maxBytes ? new Uint8Array(buffer) : null
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const chunk = await reader.read()
      throwIfAborted(signal)
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(chunk.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener("abort", cancel)
  }
  const bytes = new Uint8Array(bytesRead)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throwIfAborted(signal)
  return await new Promise((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("The operation was aborted")
      error.name = "AbortError"
      reject(error)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })
}

/** Extracts text-bearing PDFs while leaving image-only documents to future OCR. */
export class PdfExtractor {
  readonly #maxBytes: number
  readonly #maxPages: number
  readonly #maxTextChars: number
  readonly #parseTimeoutMs: number
  readonly #timeoutMs: number

  constructor(config: PdfExtractorConfig = {}) {
    this.#maxBytes = config.maxBytes ?? DEFAULT_MAX_PDF_BYTES
    this.#maxPages = requireIntegerInRange("maxPages", config.maxPages ?? DEFAULT_MAX_PDF_PAGES, MAX_PDF_PAGES)
    this.#maxTextChars = requireIntegerInRange("maxTextChars", config.maxTextChars ?? DEFAULT_MAX_PDF_TEXT_CHARS, MAX_PDF_TEXT_CHARS)
    this.#parseTimeoutMs = config.parseTimeoutMs ?? DEFAULT_PDF_PARSE_TIMEOUT_MS
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_PDF_FETCH_TIMEOUT_MS
  }

  async extract(input: PdfExtractorInput): Promise<PdfExtractorResult | null> {
    return addAbortableQueueTask(
      pdfExtractionQueue,
      () => this.#extract(input),
      input.signal,
    )
  }

  async #extract(input: PdfExtractorInput): Promise<PdfExtractorResult | null> {
    validateUrl(input.url.href)
    const maxBytes = requireIntegerInRange("maxBytes", this.#maxBytes, MAX_PDF_BYTES)
    const timeoutMs = requireIntegerInRange("timeout", this.#timeoutMs, MAX_PDF_FETCH_TIMEOUT_MS)
    const cancellation = new AbortController()
    const forwardAbort = () => cancellation.abort(input.signal?.reason)
    if (input.signal?.aborted) forwardAbort()
    else input.signal?.addEventListener("abort", forwardAbort, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      cancellation.abort()
    }, timeoutMs)

    let bytes: Uint8Array | null
    try {
      throwIfAborted(cancellation.signal)
      const response = await waitForAbort(input.fetch(), cancellation.signal)
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }
      bytes = await readBytes(response, maxBytes, cancellation.signal)
    } catch {
      if (input.signal?.aborted) throwIfAborted(input.signal)
      if (timedOut) return null
      return null
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", forwardAbort)
    }

    if (!bytes || !isPdfBytes(bytes)) return null
    throwIfAborted(input.signal)
    let result: PdfTextExtraction
    try {
      result = await extractPdfInProcess({
        bytes,
        maxPages: this.#maxPages,
        maxTextChars: this.#maxTextChars,
        signal: input.signal,
        timeoutMs: this.#parseTimeoutMs,
      })
      throwIfAborted(input.signal)
    } catch {
      if (input.signal?.aborted) throwIfAborted(input.signal)
      return null
    }
    const warning = result.truncatedBy === "text"
      ? `PDF extraction stopped after ${this.#maxTextChars} text characters.`
      : result.truncatedBy === "pages"
        ? `PDF extraction stopped after ${result.pages.length} of ${result.totalPages} pages.`
        : undefined
    const content = formatPdfText(result.pages, result.totalPages)
    return content ? { content, warnings: warning ? [warning] : undefined } : null
  }
}
