import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import { getJson } from "./api.ts"

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("retains structured response details for failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    )

    await expect(getJson("/api/missing", z.object({}))).rejects.toMatchObject({
      method: "GET",
      status: 404,
      url: "/api/missing",
    })
  })
})
