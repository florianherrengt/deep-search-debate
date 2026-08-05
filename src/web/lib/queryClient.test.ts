import { describe, expect, it } from "vitest"
import z from "zod"
import { ApiError } from "./api.ts"
import {
  createAppQueryClient,
  shouldRetryQuery,
} from "./queryClient.ts"

describe("query retry policy", () => {
  it("rejects permanent HTTP failures without retrying", () => {
    expect(
      shouldRetryQuery(0, new ApiError("GET", "/api/missing", 404)),
    ).toBe(false)
    expect(
      shouldRetryQuery(0, new ApiError("GET", "/api/forbidden", 403)),
    ).toBe(false)
  })

  it("retries transient failures with a finite cap", () => {
    expect(
      shouldRetryQuery(0, new ApiError("GET", "/api/jobs", 500)),
    ).toBe(true)
    expect(
      shouldRetryQuery(0, new ApiError("GET", "/api/jobs", 429)),
    ).toBe(true)
    expect(shouldRetryQuery(0, new TypeError("Network unavailable"))).toBe(true)
    expect(shouldRetryQuery(3, new TypeError("Network unavailable"))).toBe(false)
  })

  it("does not retry malformed response payloads", () => {
    expect(shouldRetryQuery(0, new SyntaxError("Invalid JSON"))).toBe(false)
    expect(shouldRetryQuery(0, z.string().safeParse(42).error)).toBe(false)
  })

  it("installs the policy on the application query client", () => {
    expect(createAppQueryClient().getDefaultOptions().queries?.retry).toBe(
      shouldRetryQuery,
    )
  })
})
