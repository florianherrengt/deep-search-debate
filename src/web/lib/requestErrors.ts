import z from "zod"
import { ApiError, type ApiErrorCode } from "./api.ts"

const apiErrorMessages: Record<ApiErrorCode, string> = {
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
  "model-selection-required":
    "Choose Small and Big models in Settings before starting work.",
}

export function getRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code !== undefined) {
      return apiErrorMessages[error.code]
    }
    if (error.status === 403) {
      return "You do not have permission to access this resource."
    }
    if (error.status >= 500) {
      return "The server could not complete the request. Try again."
    }
    return "The request could not be completed. Check the details and try again."
  }

  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return "The server returned data in an unexpected format. Try again."
  }

  return "Could not connect to the server. Check your connection and try again."
}
