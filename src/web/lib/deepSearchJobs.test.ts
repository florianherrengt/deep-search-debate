import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createDeepSearchJob,
  getDeepSearchJob,
  getDeepSearchJobs,
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
      round: 0,
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
      .mockResolvedValueOnce(
        Response.json(
          { deepSearchJobId: "job-id", slug: "research-this" },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "query-stream", round: 0, streamId: "query-stream-id" },
          searchResults,
          {
            type: "selection-stream",
            round: 0,
            query: "test query",
            streamId: "selection-stream-id",
          },
          {
            type: "selected-search-results",
            round: 0,
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
            round: 0,
            query: "test query",
            streamId: "query-summary-stream-id",
          },
          {
            type: "round-answer-stream",
            round: 0,
            streamId: "final-answer-stream-id",
          },
          {
            type: "round-review-stream",
            round: 0,
            streamId: "review-stream-id",
          },
          {
            type: "round-review",
            round: 0,
            decision: "stop",
            reason: "The evidence is sufficient.",
          },
          {
            type: "final-answer-stream",
            streamId: "final-answer-stream-id",
          },
          { type: "done" },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)

    const created = await createDeepSearchJob({ researchRequest: "Research this" })
    const events = await drain(
      subscribeToDeepSearchJob(created.deepSearchJobId),
    )

    expect(created).toEqual({
      deepSearchJobId: "job-id",
      slug: "research-this",
    })
    expect(events).toEqual([
      { type: "query-stream", round: 0, streamId: "query-stream-id" },
      searchResults,
      {
        type: "selection-stream",
        round: 0,
        query: "test query",
        streamId: "selection-stream-id",
      },
      {
        type: "selected-search-results",
        round: 0,
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
        round: 0,
        query: "test query",
        streamId: "query-summary-stream-id",
      },
      {
        type: "round-answer-stream",
        round: 0,
        streamId: "final-answer-stream-id",
      },
      {
        type: "round-review-stream",
        round: 0,
        streamId: "review-stream-id",
      },
      {
        type: "round-review",
        round: 0,
        decision: "stop",
        reason: "The evidence is sufficient.",
      },
      {
        type: "final-answer-stream",
        streamId: "final-answer-stream-id",
      },
      { type: "done" },
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/deep-search-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        researchRequest: "Research this",
      }),
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/deep-search-jobs/job-id/events",
      { signal: undefined },
    )
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

  it("lists history and reads one durable job", async () => {
    const job = {
      deepSearchJobId: "job-id",
      title: "Research This",
      slug: "research-this",
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRounds: 3,
      status: "completed" as const,
      error: null,
      createdAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:01:00.000Z",
      origin: null,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ deepSearchJobs: [job] }))
      .mockResolvedValueOnce(Response.json({ deepSearchJob: job }))
    vi.stubGlobal("fetch", fetchMock)

    const parsedListJob = {
      ...job,
      createdAt: new Date(job.createdAt),
      completedAt: new Date(job.completedAt),
    }
    const parsedDetailJob = {
      deepSearchJobId: "job-id",
      title: "Research This",
      slug: "research-this",
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRounds: 3,
      status: "completed",
      error: null,
      createdAt: new Date(job.createdAt),
      completedAt: new Date(job.completedAt),
    }
    await expect(getDeepSearchJobs("manual")).resolves.toEqual([parsedListJob])
    await expect(getDeepSearchJob("research-this")).resolves.toEqual(
      parsedDetailJob,
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/deep-search-jobs?source=manual",
      { signal: undefined },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/deep-search-jobs/research-this",
      { signal: undefined },
    )
  })

  it("parses the originating debate on automated job list items", async () => {
    const automatedJob = {
      deepSearchJobId: "automated-job-id",
      title: "Automated Search",
      slug: "automated-search",
      researchRequest: "Research for a debate",
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRounds: 3,
      status: "completed" as const,
      error: null,
      createdAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:01:00.000Z",
      origin: {
        kind: "debate" as const,
        title: "Debate Title",
        slug: "debate-title",
      },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ deepSearchJobs: [automatedJob] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getDeepSearchJobs("automated")).resolves.toEqual([
      {
        ...automatedJob,
        createdAt: new Date(automatedJob.createdAt),
        completedAt: new Date(automatedJob.completedAt),
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deep-search-jobs?source=automated",
      { signal: undefined },
    )
  })

  it("rejects malformed job responses and events", async () => {
    const invalidEvent = new Response(
      JSON.stringify({ type: "page-summary-stream", url: "not-a-url" }) +
        "\n",
      { status: 200 },
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ deepSearchJobs: [{ deepSearchJobId: 123 }] }),
      )
      .mockResolvedValueOnce(invalidEvent)
    vi.stubGlobal("fetch", fetchMock)

    await expect(getDeepSearchJobs("manual")).rejects.toThrow()
    await expect(
      drain(subscribeToDeepSearchJob("job-id")),
    ).rejects.toThrow()
  })

  it("rejects malformed job timestamps before they reach the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          deepSearchJobs: [
            {
              deepSearchJobId: "job-id",
              title: "Research This",
              slug: "research-this",
              researchRequest: "Research this",
              maxSearches: 3,
              maxResultsPerSearch: 3,
              maxRounds: 3,
              status: "running",
              error: null,
              createdAt: "not-a-date",
              completedAt: null,
              origin: null,
            },
          ],
        }),
      ),
    )

    await expect(getDeepSearchJobs("manual")).rejects.toThrow()
  })

  it("rejects list items with an unknown origin kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          deepSearchJobs: [
            {
              deepSearchJobId: "job-id",
              title: "Research This",
              slug: "research-this",
              researchRequest: "Research this",
              maxSearches: 3,
              maxResultsPerSearch: 3,
              maxRounds: 3,
              status: "completed",
              error: null,
              createdAt: "2026-08-01T12:00:00.000Z",
              completedAt: "2026-08-01T12:01:00.000Z",
              origin: { kind: "unknown", title: "X", slug: "x" },
            },
          ],
        }),
      ),
    )

    await expect(getDeepSearchJobs("automated")).rejects.toThrow()
  })
})
