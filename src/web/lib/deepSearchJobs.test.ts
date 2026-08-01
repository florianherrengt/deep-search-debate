import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createDeepSearchJob,
  subscribeToDeepSearchJob,
  type DeepSearchJobEvent,
} from "./deepSearchJobs.ts"

function ndjsonResponse(events: DeepSearchJobEvent[]): Response {
  const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n"
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  })
}

async function drain(
  events: AsyncGenerator<DeepSearchJobEvent>,
): Promise<DeepSearchJobEvent[]> {
  const result: DeepSearchJobEvent[] = []
  for await (const event of events) result.push(event)
  return result
}

describe("deep search jobs client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("creates a job and subscribes to its search results", async () => {
    const searchResults: DeepSearchJobEvent = {
      type: "search-results",
      searches: [
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
      ],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "job-id" }, { status: 202 }))
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "query-stream", streamId: "query-stream-id" },
          searchResults,
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
            type: "query-summary-stream",
            query: "test query",
            streamId: "query-summary-stream-id",
          },
          { type: "done" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)

    const id = await createDeepSearchJob({ researchRequest: "Research this" })
    const events = await drain(subscribeToDeepSearchJob(id))

    expect(id).toBe("job-id")
    expect(events).toEqual([
      { type: "query-stream", streamId: "query-stream-id" },
      searchResults,
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
        type: "query-summary-stream",
        query: "test query",
        streamId: "query-summary-stream-id",
      },
      { type: "done" },
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/deep-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        researchRequest: "Research this",
        maxSearches: 3,
        maxResultsPerSearch: 3,
      }),
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/deep-search/job-id", {
      signal: undefined,
    })
  })

  it("surfaces creation and subscription failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )

    await expect(
      createDeepSearchJob({ researchRequest: "Research this" }),
    ).rejects.toThrow(/500/)
    await expect(
      drain(subscribeToDeepSearchJob("job-id")),
    ).rejects.toThrow(/500/)
  })
})
