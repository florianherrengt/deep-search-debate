import { z } from "zod"

import type { LlmReasoningEffort } from "./modelSettings.ts"

const MAX_ATTEMPT_HISTORY = 12
const MAX_DIAGNOSTIC_FAILURES = 12
const MAX_FRAME_BYTES = 64 * 1024
const MAX_DECODE_CHUNK_BYTES = 8 * 1024
const MAX_SAFE_FIELD_LENGTH = 128

const networkErrorCodes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EPIPE",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EAI_FAIL",
])

const codexErrorCodes = new Set([
  "authentication-required",
  "rate-limited",
  "workspace-disabled",
  "protocol-incompatible",
  "temporarily-unavailable",
  "timeout",
  "tool-blocked",
])

const zodIssueCodes = new Set([
  "custom",
  "invalid_element",
  "invalid_format",
  "invalid_key",
  "invalid_type",
  "invalid_union",
  "invalid_value",
  "not_multiple_of",
  "too_big",
  "too_small",
  "unrecognized_keys",
])

const safeErrorNames = new Set([
  "AbortError",
  "CodexApiError",
  "CodexProtocolError",
  "Error",
  "OpenAiCodexError",
  "RangeError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "WorkflowFailure",
  "WorkflowInterruptedError",
  "ZodError",
])

const databaseErrorCodes = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_CANTOPEN",
  "SQLITE_CONSTRAINT",
  "SQLITE_CONSTRAINT_FOREIGNKEY",
  "SQLITE_CORRUPT",
  "SQLITE_FULL",
  "SQLITE_IOERR",
  "SQLITE_LOCKED",
  "SQLITE_READONLY",
])

const providerTokenSchema = z.string()
  .min(1)
  .max(MAX_SAFE_FIELD_LENGTH)
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .optional()
  .catch(undefined)
const providerParamSchema = z.string()
  .min(1)
  .max(MAX_SAFE_FIELD_LENGTH)
  .regex(/^[A-Za-z0-9_.:[\]-]+$/)
  .optional()
  .catch(undefined)
const providerErrorSchema = z.looseObject({
  code: providerTokenSchema,
  type: providerTokenSchema,
  param: providerParamSchema,
})
const providerEventSchema = z.looseObject({
  type: providerTokenSchema,
  code: providerTokenSchema,
  param: providerParamSchema,
  error: providerErrorSchema.optional().catch(undefined),
  response: z.looseObject({
    error: providerErrorSchema.optional().catch(undefined),
    incomplete_details: z.looseObject({ reason: providerTokenSchema }).optional().catch(undefined),
  }).optional().catch(undefined),
})

export type LlmProviderDiagnostics = {
  attemptCount: number
  maxRetries: number
  firstChunkTimeoutMs: number
  chunkTimeoutMs: number
  reasoningEffort?: LlmReasoningEffort
  attempts: Array<{
    attempt: number
    status?: number
    durationMs?: number
    requestId?: string
    retryAfterMs?: number
    transportFailure?: "timeout" | "connection-reset" | "dns" | "network"
    transportCode?: string
  }>
  failures: Array<{
    attempt: number
    source: "http" | "sse"
    eventType?: "error" | "response.failed" | "response.incomplete"
    code?: string
    type?: string
    param?: string
    reason?: string
  }>
  streamEnd?: "eof-before-terminal"
  parseFailure?: "invalid-sse-json" | "invalid-http-error-json"
  truncated?: boolean
}

export type LlmFailureDescription = {
  category: "abort" | "codex" | "database" | "invalid-json" | "network" | "provider" | "timeout" | "validation" | "error"
  code?: string
  name?: string
  issueCount?: number
  issueCodes?: string[]
}

export function describeLlmFailure(error: unknown): LlmFailureDescription {
  try {
    const record = asRecord(error)
    const rawName = error instanceof Error ? error.name : undefined
    const name = rawName && safeErrorNames.has(rawName) ? rawName : undefined
    const rawCode = record?.code ?? asRecord(error instanceof Error ? error.cause : undefined)?.code
    const code = knownCode(rawCode) ?? knownDatabaseCode(rawCode)
    const issues = Array.isArray(record?.issues) ? record.issues : undefined
    const issueCodes = issues
      ?.slice(0, 20)
      ?.flatMap((issue) => {
        const issueCode = asRecord(issue)?.code
        return typeof issueCode === "string" && zodIssueCodes.has(issueCode)
          ? [issueCode]
          : []
      })
      .filter((issueCode, index, values) => values.indexOf(issueCode) === index)
      .slice(0, 5)

    let category: LlmFailureDescription["category"] = "error"
    if (name === "AbortError" || name === "WorkflowInterruptedError") {
      category = "abort"
    } else if (name === "TimeoutError" || code === "ETIMEDOUT") {
      category = "timeout"
    } else if (name === "SyntaxError") {
      category = "invalid-json"
    } else if (name === "ZodError" || issueCodes?.length) {
      category = "validation"
    } else if (name === "OpenAiCodexError" || (code && codexErrorCodes.has(code))) {
      category = "codex"
    } else if (name === "CodexApiError" || name === "CodexProtocolError") {
      category = "provider"
    } else if (code && databaseErrorCodes.has(code)) {
      category = "database"
    } else if (code && networkErrorCodes.has(code)) {
      category = "network"
    }

    return {
      category,
      ...(code && { code }),
      ...(name && { name }),
      ...(issues && { issueCount: issues.length }),
      ...(issueCodes && issueCodes.length > 0 && { issueCodes }),
    }
  } catch {
    return { category: "error" }
  }
}

export function createLlmProviderDiagnostics(input: {
  maxRetries: number
  firstChunkTimeoutMs: number
  chunkTimeoutMs: number
  reasoningEffort: LlmReasoningEffort
}): LlmProviderDiagnostics {
  return {
    attemptCount: 0,
    maxRetries: input.maxRetries,
    firstChunkTimeoutMs: input.firstChunkTimeoutMs,
    chunkTimeoutMs: input.chunkTimeoutMs,
    reasoningEffort: input.reasoningEffort,
    attempts: [],
    failures: [],
  }
}

/** Creates bounded, best-effort provider diagnostics without consuming or changing body bytes. */
export function observeLlmProviderRequests(
  diagnostics: LlmProviderDiagnostics,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    diagnostics.attemptCount += 1
    const attemptNumber = diagnostics.attemptCount
    const startedAt = Date.now()
    const attempt = {
      attempt: attemptNumber,
    } satisfies LlmProviderDiagnostics["attempts"][number]
    if (diagnostics.attempts.length < MAX_ATTEMPT_HISTORY) {
      diagnostics.attempts.push(attempt)
    } else {
      diagnostics.truncated = true
    }

    const latestAttempt = diagnostics.attempts.at(-1)
    const currentAttempt: LlmProviderDiagnostics["attempts"][number] =
      latestAttempt?.attempt === attemptNumber ? latestAttempt : attempt
    const completeAttempt = () => {
      currentAttempt.durationMs = Math.max(0, Date.now() - startedAt)
    }

    let response: Response
    try {
      response = await fetchImpl(input, init)
    } catch (error) {
      completeAttempt()
      recordTransportFailureSafely(currentAttempt, error, requestSignal(input, init))
      throw error
    }

    try {
      currentAttempt.status = response.status
      currentAttempt.requestId = getRequestId(response.headers)
      currentAttempt.retryAfterMs = getRetryAfterMs(response.headers)
      completeAttempt()
      if (!(response instanceof Response) || !response.body || [204, 205, 304].includes(response.status)) {
        completeAttempt()
        return response
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
      const inspectSse = contentType.includes("text/event-stream")
      if (response.ok && !inspectSse) return response
      const observer = new BoundedBodyObserver({
        attempt: attemptNumber,
        diagnostics,
        inspectSse,
        inspectHttpError: !response.ok,
      })
      const body = observeBody(response.body, observer, currentAttempt, startedAt, diagnostics, input, init)
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch {
      // A diagnostic failure must never replace the provider response or alter retry behavior.
      completeAttempt()
      return response
    }
  }
}

function observeBody(
  body: ReadableStream<Uint8Array>,
  observer: BoundedBodyObserver,
  attempt: LlmProviderDiagnostics["attempts"][number],
  startedAt: number,
  diagnostics: LlmProviderDiagnostics,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let finished = false
  const complete = (naturalEnd: boolean) => {
    if (finished) return
    finished = true
    observer.finish(naturalEnd)
    attempt.durationMs = Math.max(0, Date.now() - startedAt)
    try {
      reader?.releaseLock()
    } catch {
      diagnostics.truncated = true
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        reader ??= body.getReader()
        const result = await reader.read()
        if (finished) return
        attempt.durationMs = Math.max(0, Date.now() - startedAt)
        if (result.done) {
          complete(true)
          controller.close()
          return
        }
        observer.observe(result.value)
        controller.enqueue(result.value)
      } catch (error) {
        if (finished) return
        attempt.durationMs = Math.max(0, Date.now() - startedAt)
        recordTransportFailureSafely(attempt, error, requestSignal(input, init))
        try {
          observer.finish(false)
        } catch {
          diagnostics.truncated = true
        }
        controller.error(error)
        try {
          reader?.releaseLock()
        } catch {
          diagnostics.truncated = true
        }
      }
    },
    async cancel(reason) {
      finished = true
      attempt.durationMs = Math.max(0, Date.now() - startedAt)
      try {
        if (reader) await reader.cancel(reason)
        else await body.cancel(reason)
      } finally {
        try {
          reader?.releaseLock()
        } catch {
          diagnostics.truncated = true
        }
      }
    },
  })
}

class BoundedBodyObserver {
  private readonly decoder = new TextDecoder()
  private buffer = ""
  private discardingOversizedFrame = false
  private discardingHasNewline = false
  private pendingCarriageReturn = false
  private sawTerminalEvent = false
  private readonly httpBody: string[] = []
  private httpBodyBytes = 0
  private readonly options: {
    attempt: number
    diagnostics: LlmProviderDiagnostics
    inspectSse: boolean
    inspectHttpError: boolean
  }

  constructor(options: {
    attempt: number
    diagnostics: LlmProviderDiagnostics
    inspectSse: boolean
    inspectHttpError: boolean
  }) {
    this.options = options
  }

  observe(chunk: Uint8Array): void {
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_DECODE_CHUNK_BYTES) {
      try {
        const text = this.decoder.decode(
          chunk.subarray(offset, offset + MAX_DECODE_CHUNK_BYTES),
          { stream: true },
        )
        if (this.options.inspectSse) {
          this.observeSse(text)
        } else if (this.options.inspectHttpError) {
          this.observeHttpError(text)
        }
      } catch {
        this.options.diagnostics.truncated = true
      }
    }
  }

  finish(naturalEnd: boolean): void {
    try {
      const trailing = this.decoder.decode()
      if (this.options.inspectSse) {
        this.observeSse(trailing, true)
        if (this.buffer.trim()) this.observeSseFrame(this.buffer)
        this.buffer = ""
        if (naturalEnd && !this.sawTerminalEvent) {
          this.options.diagnostics.streamEnd = "eof-before-terminal"
        }
      } else if (this.options.inspectHttpError) {
        this.observeHttpError(trailing)
        if (naturalEnd && this.httpBodyBytes > 0) this.parseHttpErrorBody()
      }
    } catch {
      this.options.diagnostics.truncated = true
    }
  }

  private observeSse(text: string, final = false): void {
    text = this.normalizeSseLineEndings(text, final)
    if (this.discardingOversizedFrame) {
      const delimiterSpansChunks = this.discardingHasNewline && text.startsWith("\n")
      const delimiter = delimiterSpansChunks ? 0 : text.indexOf("\n\n")
      if (delimiter < 0) {
        this.discardingHasNewline = text.endsWith("\n")
        return
      }
      text = text.slice(delimiterSpansChunks ? 1 : delimiter + 2)
      this.discardingOversizedFrame = false
      this.discardingHasNewline = false
    }
    this.buffer += text
    while (true) {
      const delimiter = this.buffer.indexOf("\n\n")
      if (delimiter < 0) {
        if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES) {
          this.options.diagnostics.truncated = true
          this.discardingHasNewline = this.buffer.endsWith("\n")
          this.buffer = ""
          this.discardingOversizedFrame = true
        }
        return
      }
      const frame = this.buffer.slice(0, delimiter)
      this.buffer = this.buffer.slice(delimiter + 2)
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
        this.options.diagnostics.truncated = true
      } else if (!this.discardingOversizedFrame) {
        this.observeSseFrame(frame)
      }
    }
  }

  private observeSseFrame(frame: string): void {
    const lines = frame.split("\n")
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim()
    if (!data) return
    if (data === "[DONE]") {
      this.sawTerminalEvent = true
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data) as unknown
    } catch {
      this.options.diagnostics.parseFailure ??= "invalid-sse-json"
      return
    }
    this.observeProviderEvent(parsed, true)
  }

  private normalizeSseLineEndings(text: string, final: boolean): string {
    let normalized = ""
    let offset = 0
    if (this.pendingCarriageReturn) {
      normalized += "\n"
      this.pendingCarriageReturn = false
      if (text.startsWith("\n")) offset = 1
    }
    for (let index = offset; index < text.length; index += 1) {
      const character = text[index]
      if (character === "\r") {
        if (index + 1 === text.length) {
          this.pendingCarriageReturn = true
        } else {
          normalized += "\n"
          if (text[index + 1] === "\n") index += 1
        }
      } else {
        normalized += character
      }
    }
    if (final && this.pendingCarriageReturn) {
      normalized += "\n"
      this.pendingCarriageReturn = false
    }
    return normalized
  }

  private observeHttpError(text: string): void {
    if (!text) return
    const remainingBytes = MAX_FRAME_BYTES - this.httpBodyBytes
    if (remainingBytes <= 0) {
      this.options.diagnostics.truncated = true
      return
    }
    const encoded = new TextEncoder().encode(text)
    if (encoded.byteLength > remainingBytes) {
      this.httpBody.push(new TextDecoder().decode(encoded.subarray(0, remainingBytes)))
      this.httpBodyBytes = MAX_FRAME_BYTES
      this.options.diagnostics.truncated = true
      return
    }
    this.httpBody.push(text)
    this.httpBodyBytes += encoded.byteLength
  }

  private parseHttpErrorBody(): void {
    try {
      this.observeProviderEvent(JSON.parse(this.httpBody.join("")) as unknown, false)
    } catch {
      this.options.diagnostics.parseFailure ??= "invalid-http-error-json"
    }
  }

  private observeProviderEvent(value: unknown, sse: boolean): void {
    const parsed = providerEventSchema.safeParse(value)
    if (!parsed.success) return
    const root = parsed.data
    const eventType = root.type
    const response = root.response
    const responseError = response?.error
    const topError = root.error
    const isError = eventType === "error" || eventType === "response.failed" ||
      Boolean(topError) || (!sse && Boolean(responseError))
    const isIncomplete = eventType === "response.incomplete"
    const source = sse ? "sse" : "http"

    if (isError || isIncomplete) {
      const failureType = isIncomplete
        ? "response.incomplete"
        : eventType === "response.failed"
          ? "response.failed"
          : eventType === "error" || Boolean(topError)
            ? "error"
            : undefined
      const error = responseError ?? topError
      const incompleteDetails = response?.incomplete_details
      const code = error?.code ?? (eventType === "error" ? root.code : undefined)
      const param = error?.param ?? (eventType === "error" ? root.param : undefined)
      const failure = {
        attempt: this.options.attempt,
        source,
        ...(failureType && { eventType: failureType }),
        ...(code && { code }),
        ...(error?.type && { type: error.type }),
        ...(param && { param }),
        ...(incompleteDetails?.reason && { reason: incompleteDetails.reason }),
      } satisfies LlmProviderDiagnostics["failures"][number]
      if (this.options.diagnostics.failures.length < MAX_DIAGNOSTIC_FAILURES) {
        this.options.diagnostics.failures.push(failure)
      } else {
        this.options.diagnostics.truncated = true
      }
    }
    if (
      eventType === "response.completed" || eventType === "response.done" ||
      eventType === "response.failed" || eventType === "response.incomplete" ||
      eventType === "error"
    ) {
      this.sawTerminalEvent = true
    }
  }
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined)
}

function recordTransportFailure(
  attempt: LlmProviderDiagnostics["attempts"][number],
  error: unknown,
  signal?: AbortSignal,
): void {
  const errorName = error instanceof Error ? error.name : undefined
  const signalName = signal?.reason instanceof Error ? signal.reason.name : undefined
  const code = knownNetworkCode(asRecord(error)?.code) ??
    knownNetworkCode(asRecord(error instanceof Error ? error.cause : undefined)?.code)
  if (signal?.aborted && errorName !== "TimeoutError" && signalName !== "TimeoutError") {
    return
  }
  let category: NonNullable<typeof attempt.transportFailure> = "network"
  if (errorName === "TimeoutError" || signalName === "TimeoutError" || code === "ETIMEDOUT") {
    category = "timeout"
  } else if (code === "ECONNRESET" || code === "ECONNABORTED" || code === "EPIPE") {
    category = "connection-reset"
  } else if (code === "EAI_AGAIN" || code === "EAI_FAIL" || code === "ENOTFOUND") {
    category = "dns"
  }
  attempt.transportFailure = category
  if (code) attempt.transportCode = code
}

function recordTransportFailureSafely(
  attempt: LlmProviderDiagnostics["attempts"][number],
  error: unknown,
  signal?: AbortSignal,
): void {
  try {
    recordTransportFailure(attempt, error, signal)
  } catch {
    // Never let observation replace the provider's original transport error.
  }
}

function getRequestId(headers: Headers): string | undefined {
  for (const name of ["x-request-id", "openai-request-id", "request-id"]) {
    const value = headers.get(name)
    const safe = safeField(value, /^[A-Za-z0-9._:-]+$/)
    if (safe) return safe
  }
  return undefined
}

function getRetryAfterMs(headers: Headers): number | undefined {
  const milliseconds = headers.get("retry-after-ms")
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds.trim())) {
    const value = Number(milliseconds)
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const retryAfter = headers.get("retry-after")?.trim()
  if (!retryAfter) return undefined
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    const value = Number(retryAfter) * 1_000
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const date = Date.parse(retryAfter)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function knownNetworkCode(value: unknown): string | undefined {
  return typeof value === "string" && networkErrorCodes.has(value)
    ? value
    : undefined
}

function knownCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return codexErrorCodes.has(value) || networkErrorCodes.has(value)
    ? value
    : undefined
}

function knownDatabaseCode(value: unknown): string | undefined {
  return typeof value === "string" && databaseErrorCodes.has(value)
    ? value
    : undefined
}

function safeField(value: unknown, pattern: RegExp): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SAFE_FIELD_LENGTH ||
    !pattern.test(value)
  ) {
    return undefined
  }
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined
}
