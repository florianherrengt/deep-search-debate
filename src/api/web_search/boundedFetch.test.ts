import { describe, expect, it, vi } from "vitest"
import { createBoundedFetch } from "./boundedFetch.ts"

describe("bounded web-search fetch", () => {
  it("rejects a declared oversized provider response", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("too large", {
        headers: { "content-length": "101" },
      }),
    )
    const boundedFetch = createBoundedFetch(100, fetchImpl)

    await expect(boundedFetch("https://search.example.com")).rejects.toThrow(
      "Web search response exceeded 100 bytes",
    )
  })

  it("rejects an oversized streamed response without a length header", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new Uint8Array(101)),
    )
    const boundedFetch = createBoundedFetch(100, fetchImpl)

    await expect(boundedFetch("https://search.example.com")).rejects.toThrow(
      "Web search response exceeded 100 bytes",
    )
  })

  it("preserves a valid empty response without constructing a forbidden body", async () => {
    const fetchImpl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))
    const boundedFetch = createBoundedFetch(100, fetchImpl)

    const response = await boundedFetch("https://search.example.com")

    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe("")
  })
})
