import { QueryClient } from "@tanstack/react-query"
import z from "zod"
import { ApiError } from "./api.ts"

const MAXIMUM_QUERY_RETRIES = 3

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** Retries transient requests while surfacing permanent contract failures immediately. */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAXIMUM_QUERY_RETRIES) return false
  if (error instanceof ApiError) return isTransientStatus(error.status)
  if (error instanceof z.ZodError || error instanceof SyntaxError) return false
  return true
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
    },
  })
}
