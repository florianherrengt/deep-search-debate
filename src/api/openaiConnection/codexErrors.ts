export type OpenAiCodexErrorCode =
  | "authentication-required"
  | "rate-limited"
  | "workspace-disabled"
  | "protocol-incompatible"
  | "temporarily-unavailable"
  | "timeout"
  | "tool-blocked"

const safeMessages: Record<OpenAiCodexErrorCode, string> = {
  "authentication-required":
    "Your OpenAI connection has expired. Disconnect it and connect again.",
  "rate-limited":
    "Your OpenAI subscription is temporarily rate-limited. Try again after its usage limit resets.",
  "workspace-disabled":
    "Codex access is disabled for this OpenAI workspace. Contact its administrator or connect another account.",
  "protocol-incompatible":
    "This OpenAI connection is not compatible with the current Codex integration. Try connecting again later.",
  "temporarily-unavailable":
    "OpenAI Codex is temporarily unavailable. Try again later.",
  timeout: "OpenAI Codex timed out. Try again.",
  "tool-blocked":
    "OpenAI Codex attempted to use a tool that RethinkLoop does not permit.",
}

/** Carries only a stable code and a message that is safe to persist or return. */
export class OpenAiCodexError extends Error {
  override readonly name = "OpenAiCodexError"
  readonly code: OpenAiCodexErrorCode

  constructor(code: OpenAiCodexErrorCode) {
    super(safeMessages[code])
    this.code = code
  }
}

export function classifyCodexError(error: unknown): OpenAiCodexError {
  if (error instanceof OpenAiCodexError) return error

  // Inspect upstream fields only inside this boundary. The original error and
  // its text must never be logged, persisted, or returned to the caller.
  const record = error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : undefined
  const text = [
    error instanceof Error ? error.name : "",
    error instanceof Error ? error.message : error,
    record?.code,
    record?.status,
  ].join(" ").toLowerCase()

  if (
    text.includes("usage_limit_exceeded") ||
    text.includes("usagelimitexceeded") ||
    text.includes("rate limit") ||
    text.includes("status 429") ||
    text.includes("http 429") ||
    text.includes(" 429")
  ) {
    return new OpenAiCodexError("rate-limited")
  }
  if (
    record?.code === "oauth" ||
    record?.code === "auth" ||
    text.includes("unauthorized") ||
    text.includes("authentication") ||
    text.includes("not logged in") ||
    text.includes("login required") ||
    text.includes("credential") ||
    text.includes("decrypt") ||
    text.includes("status 401") ||
    text.includes("http 401") ||
    text.includes(" 401")
  ) {
    return new OpenAiCodexError("authentication-required")
  }
  if (
    text.includes("workspace") &&
    (text.includes("disabled") || text.includes("not enabled"))
  ) {
    return new OpenAiCodexError("workspace-disabled")
  }
  if (
    text.includes("timed out") ||
    text.includes("timeout") ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return new OpenAiCodexError("timeout")
  }
  if (
    text.includes("codexprotocolerror") ||
    text.includes("schema validation") ||
    text.includes("default model") ||
    text.includes("reasoning effort")
  ) {
    return new OpenAiCodexError("protocol-incompatible")
  }
  return new OpenAiCodexError("temporarily-unavailable")
}

export function codexFinishReasonError(
  rawFinishReason: string | undefined,
): OpenAiCodexError | undefined {
  switch (rawFinishReason) {
    case "completed":
      return undefined
    case "interrupted":
      return new OpenAiCodexError("temporarily-unavailable")
    case "usage_limit_exceeded":
      return new OpenAiCodexError("rate-limited")
    case "unauthorized":
      return new OpenAiCodexError("authentication-required")
    default:
      return new OpenAiCodexError("protocol-incompatible")
  }
}
