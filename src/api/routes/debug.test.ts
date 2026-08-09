import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Hono } from "hono"

const mocks = vi.hoisted(() => ({
  webExtract: vi.fn(),
  webSearch: vi.fn(),
}))

vi.mock("../web_search/index.ts", () => ({
  webSearch: mocks.webSearch,
}))

vi.mock("../web_search/webExtract.ts", () => ({
  webExtract: mocks.webExtract,
}))

import { debug } from "./debug.ts"
import type { AppEnv } from "../types/auth.ts"

function createApp(isDebugUser: boolean): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("isDebugUser", isDebugUser)
    c.set("userId", "test-user-id")
    await next()
  })
  debug(app)
  return app
}

const app = createApp(true)
const regularUserApp = createApp(false)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

it("hides debug routes from ordinary authenticated users", async () => {
  const response = await regularUserApp.request("/api/debug/search?query=hello")

  expect(response.status).toBe(404)
  expect(mocks.webSearch).not.toHaveBeenCalled()
})

describe("GET /api/debug/search", () => {
  it("returns search results", async () => {
    const mockResults = [
      { title: "Result 1", shortText: "Snippet 1", link: "https://one.com" },
      { title: "Result 2", shortText: "Snippet 2", link: "https://two.com" },
    ]
    mocks.webSearch.mockResolvedValueOnce(mockResults)

    const response = await app.request("/api/debug/search?query=hello")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ results: mockResults })
    expect(mocks.webSearch).toHaveBeenCalledWith({ query: "hello" })
  })

  it("returns 500 when webSearch fails", async () => {
    mocks.webSearch.mockRejectedValueOnce(new Error("search failed"))

    const response = await app.request("/api/debug/search?query=fail")

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Search failed" })
  })
})

describe("GET /api/debug/extract", () => {
  it("returns content and the successful retrieval method", async () => {
    mocks.webExtract.mockResolvedValueOnce({
      url: "https://example.com",
      content: "Hello World",
      retrievalMethod: "scrapingant-browser-us",
    })

    const response = await app.request(
      "/api/debug/extract?url=https%3A%2F%2Fexample.com",
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: "https://example.com",
      content: "Hello World",
      contentLength: 11,
      retrievalMethod: "scrapingant-browser-us",
    })
    expect(mocks.webExtract).toHaveBeenCalledWith({
      url: "https://example.com",
    })
  })

  it("returns a sanitized 500 when extraction fails", async () => {
    mocks.webExtract.mockRejectedValueOnce(new Error("fetch failed"))

    const response = await app.request(
      "/api/debug/extract?url=https%3A%2F%2Fexample.com",
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Extraction failed",
    })
  })

  it("rejects non-URL inputs", async () => {
    const response = await app.request("/api/debug/extract?url=not-a-url")

    expect(response.status).toBe(400)
    expect(mocks.webExtract).not.toHaveBeenCalled()
  })
})
