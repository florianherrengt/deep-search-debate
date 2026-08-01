import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DeepSearchEvent } from "../agents/deep_search/index.ts"

const mocks = vi.hoisted(() => ({ deepSearch: vi.fn() }))

vi.mock("../agents/deep_search/index.ts", () => ({
  deepSearch: mocks.deepSearch,
}))

import { deepSearchJobs, type DeepSearchJobEvent } from "./deepSearch.ts"

const searches = [
  {
    query: "test query",
    results: [
      {
        title: "Result",
        shortText: "Useful result",
        link: "https://example.com",
      },
    ],
  },
]

const progressEvents: DeepSearchEvent[] = [
  { type: "query-stream", streamId: "query-stream-id" },
  { type: "search-results", searches },
  {
    type: "selection-stream",
    query: "test query",
    streamId: "selection-stream-id",
  },
  {
    type: "selected-search-results",
    query: "test query",
    selectedLinks: ["https://example.com"],
  },
  {
    type: "page-summary-stream",
    url: "https://example.com",
    streamId: "summary-stream-id",
  },
  {
    type: "page-summary-error",
    url: "https://example.com/failed",
    stage: "extraction",
    message: "Extraction failed",
  },
]

function createApp(): Hono {
  const app = new Hono()
  deepSearchJobs(app)
  return app
}

function createJob(app: Hono, body: object = { researchRequest: "Research this" }) {
  return app.request("/deep-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function readEvents(response: Response): Promise<DeepSearchJobEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as DeepSearchJobEvent)
}

describe("deep search job routes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns a job ID and retains all published events", async () => {
    mocks.deepSearch.mockImplementation(
      (input: { onEvent: (event: DeepSearchEvent) => void }) => {
        progressEvents.forEach(input.onEvent)
        return Promise.resolve()
      },
    )
    const app = createApp()

    const created = await createJob(app)
    const { id } = (await created.json()) as { id: string }

    expect(created.status).toBe(202)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers.get("Location")).toBe(`/api/deep-search/${id}`)

    const subscribed = await app.request(`/deep-search/${id}`)
    expect(subscribed.status).toBe(200)
    expect(subscribed.headers.get("Content-Type")).toContain(
      "application/x-ndjson",
    )
    await expect(readEvents(subscribed)).resolves.toEqual([
      ...progressEvents,
      { type: "done" },
    ])
  })

  it("passes explicit search and exploration limits to the job", async () => {
    mocks.deepSearch.mockResolvedValue(undefined)
    const app = createApp()

    const created = await createJob(app, {
      researchRequest: "Research this",
      maxSearches: 5,
      maxResultsPerSearch: 2,
    })

    expect(created.status).toBe(202)
    expect(mocks.deepSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        researchRequest: "Research this",
        maxSearches: 5,
        maxResultsPerSearch: 2,
      }),
    )
  })

  it("follows events published after subscription", async () => {
    const completion = Promise.withResolvers<void>()
    let emit: ((event: DeepSearchEvent) => void) | undefined
    mocks.deepSearch.mockImplementation(
      async (input: { onEvent: (event: DeepSearchEvent) => void }) => {
        emit = input.onEvent
        await completion.promise
      },
    )
    const app = createApp()
    const created = await createJob(app)
    const { id } = (await created.json()) as { id: string }
    const subscribed = await app.request(`/deep-search/${id}`)
    const events = readEvents(subscribed)

    if (!emit) throw new Error("Deep search event sink was not registered")
    progressEvents.forEach(emit)
    completion.resolve()

    await expect(events).resolves.toEqual([
      ...progressEvents,
      { type: "done" },
    ])
  })

  it("retains failed job events", async () => {
    mocks.deepSearch.mockRejectedValue(new Error("Search failed"))
    const app = createApp()
    const created = await createJob(app)
    const { id } = (await created.json()) as { id: string }

    const subscribed = await app.request(`/deep-search/${id}`)

    await expect(readEvents(subscribed)).resolves.toEqual([
      { type: "error", message: "Search failed" },
      { type: "done" },
    ])
  })

  it("returns 404 for an unknown job", async () => {
    const response = await createApp().request("/deep-search/missing")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Deep search job not found",
    })
  })
})
