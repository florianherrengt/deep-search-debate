import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DeepSearchEvent } from "../../agents/deep_search/index.ts"

const mocks = vi.hoisted(() => ({
  deepSearch: vi.fn(),
  generatePromptTitle: vi.fn().mockResolvedValue("Research This"),
}))

vi.mock("../../agents/deep_search/index.ts", () => ({
  deepSearch: mocks.deepSearch,
}))
vi.mock("../../llms/generateText.ts", () => ({
  generatePromptTitle: mocks.generatePromptTitle,
}))

import { db } from "../../db/index.ts"
import {
  deepSearchJobs as deepSearchJobsTable,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  deepSearchJobReads,
  deepSearchJobs,
  type DeepSearchJobEvent,
} from "./index.ts"
import { createDeepSearchJobManager } from "./manager.ts"
import type { AppEnv } from "../../types/auth.ts"

const searches = [
  {
    query: "test query",
    results: [
      {
        title: "Result",
        shortText: "Useful result",
        link: "https://example.com",
      },
      {
        title: "Failed result",
        shortText: "Result whose page cannot be extracted",
        link: "https://example.com/failed",
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
    selectedLinks: ["https://example.com", "https://example.com/failed"],
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
  {
    type: "query-summary-stream",
    query: "test query",
    streamId: "query-summary-stream-id",
  },
  { type: "final-answer-stream", streamId: "final-answer-stream-id" },
]

type MockDeepSearchInput = {
  deepSearchJobId: string
  onEvent: (event: DeepSearchEvent) => void
  onQueriesGenerated?: (queries: string[]) => void
}

function insertCompletedGeneration(
  deepSearchJobId: string,
  llmGenerationId: string,
): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      deepSearchJobId,
      llmGenerationId,
      status: "completed",
      text: `Output for ${llmGenerationId}`,
      reasoning: `Reasoning for ${llmGenerationId}`,
      completedAt: new Date(),
    })
    .run()
}

function insertFailedGeneration(
  deepSearchJobId: string,
  llmGenerationId: string,
  error: string,
): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      deepSearchJobId,
      llmGenerationId,
      status: "failed",
      text: "",
      reasoning: "",
      error,
      completedAt: new Date(),
    })
    .run()
}

function prepareProgressGenerations(deepSearchJobId: string): void {
  for (const streamId of [
    "query-stream-id",
    "selection-stream-id",
    "summary-stream-id",
    "query-summary-stream-id",
    "final-answer-stream-id",
  ]) {
    insertCompletedGeneration(deepSearchJobId, streamId)
  }
}

function emitProgress(input: MockDeepSearchInput): void {
  input.onEvent(progressEvents[0])
  input.onQueriesGenerated?.(["test query"])
  for (const event of progressEvents.slice(1)) input.onEvent(event)
}

function expectDurableProgress(
  events: DeepSearchJobEvent[],
  terminalEvents: DeepSearchJobEvent[],
): void {
  expect(events.slice(0, 4)).toEqual(progressEvents.slice(0, 4))
  expect(events.slice(4, 6)).toEqual(
    expect.arrayContaining(progressEvents.slice(4, 6)),
  )
  expect(events.slice(6)).toEqual([
    ...progressEvents.slice(6),
    ...terminalEvents,
  ])
}

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", "test-user-id")
    c.set("viewerUserId", "test-user-id")
    await next()
  })
  const manager = createDeepSearchJobManager()
  deepSearchJobReads(app, manager)
  deepSearchJobs(app, manager)
  return app
}

function createJob(
  app: Hono<AppEnv>,
  body: object = { researchRequest: "Research this" },
) {
  return app.request("/deep-search-jobs", {
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
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(deepSearchJobsTable).run()
    db.delete(llmGenerations).run()
  })

  it("returns a durable job ID and retains all published events", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      prepareProgressGenerations(input.deepSearchJobId)
      emitProgress(input)
      return Promise.resolve()
    })
    const app = createApp()

    const created = await createJob(app)
    const { deepSearchJobId, slug } = (await created.json()) as {
      deepSearchJobId: string
      slug: string
    }

    expect(created.status).toBe(202)
    expect(deepSearchJobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers.get("Location")).toBe(
      `/api/deep-search-jobs/${slug}`,
    )

    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )
    expect(subscribed.status).toBe(200)
    expect(subscribed.headers.get("Content-Type")).toContain(
      "application/x-ndjson",
    )
    expectDurableProgress(await readEvents(subscribed), [{ type: "done" }])

    const detail = await app.request(`/deep-search-jobs/${slug}`)
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      deepSearchJob: {
        deepSearchJobId,
        researchRequest: "Research this",
        finalAnswerGenerationId: "final-answer-stream-id",
        status: "completed",
      },
    })

    const history = await app.request("/deep-search-jobs")
    await expect(history.json()).resolves.toMatchObject({
      deepSearchJobs: [
        {
          deepSearchJobId,
          finalAnswerGenerationId: "final-answer-stream-id",
          status: "completed",
        },
      ],
    })
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
    const inputReady = Promise.withResolvers<MockDeepSearchInput>()
    mocks.deepSearch.mockImplementation(async (next: MockDeepSearchInput) => {
      inputReady.resolve(next)
      await completion.promise
    })
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )
    const events = readEvents(subscribed)

    const input = await inputReady.promise
    prepareProgressGenerations(input.deepSearchJobId)
    emitProgress(input)
    completion.resolve()

    await expect(events).resolves.toEqual([
      ...progressEvents,
      { type: "done" },
    ])
  })

  it("reconstructs completed progress exclusively from typed rows", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      prepareProgressGenerations(input.deepSearchJobId)
      emitProgress(input)
      return Promise.resolve()
    })
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    const replayed = await createApp().request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )
    expect(replayed.status).toBe(200)
    expectDurableProgress(await readEvents(replayed), [{ type: "done" }])
  })

  it("retains failed job events", async () => {
    mocks.deepSearch.mockRejectedValue(new Error("Search failed"))
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }

    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    await expect(readEvents(subscribed)).resolves.toEqual([
      { type: "error", message: "Search failed" },
      { type: "done" },
    ])
  })

  it("fails the job when its final-answer generation fails", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      for (const streamId of [
        "query-stream-id",
        "selection-stream-id",
        "summary-stream-id",
        "query-summary-stream-id",
      ]) {
        insertCompletedGeneration(input.deepSearchJobId, streamId)
      }
      insertFailedGeneration(
        input.deepSearchJobId,
        "final-answer-stream-id",
        "Final answer generation failed",
      )
      emitProgress(input)
      return Promise.resolve()
    })
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId, slug } = (await created.json()) as {
      deepSearchJobId: string
      slug: string
    }

    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    expectDurableProgress(await readEvents(subscribed), [
      { type: "error", message: "Final answer generation failed" },
      { type: "done" },
    ])
    const detail = await app.request(`/deep-search-jobs/${slug}`)
    await expect(detail.json()).resolves.toMatchObject({
      deepSearchJob: {
        deepSearchJobId,
        status: "failed",
        error: "Final answer generation failed",
      },
    })
  })

  it("terminates with an error when terminal job persistence fails", async () => {
    const completion = Promise.withResolvers<void>()
    const inputReady = Promise.withResolvers<MockDeepSearchInput>()
    mocks.deepSearch.mockImplementation(async (input: MockDeepSearchInput) => {
      inputReady.resolve(input)
      await completion.promise
    })
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )
    const events = readEvents(subscribed)
    const input = await inputReady.promise
    insertCompletedGeneration(deepSearchJobId, "final-answer-stream-id")
    input.onEvent({
      type: "final-answer-stream",
      streamId: "final-answer-stream-id",
    })
    const update = vi.spyOn(db, "update").mockImplementation(() => {
      throw new Error("SQLite unavailable")
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      completion.resolve()

      await expect(events).resolves.toEqual([
        {
          type: "final-answer-stream",
          streamId: "final-answer-stream-id",
        },
        { type: "error", message: "SQLite unavailable" },
        { type: "done" },
      ])
      expect(consoleError).toHaveBeenCalledWith(
        `Failed to persist deep-search job ${deepSearchJobId} failure`,
        expect.objectContaining({ message: "SQLite unavailable" }),
      )
    } finally {
      update.mockRestore()
      consoleError.mockRestore()
    }
  })

  it("returns 404 for an unknown job", async () => {
    const response = await createApp().request(
      "/deep-search-jobs/11111111-1111-4111-8111-111111111111/events",
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Deep search job not found",
    })
  })

  it("rejects malformed job IDs", async () => {
    const response = await createApp().request(
      "/deep-search-jobs/not-a-uuid/events",
    )

    expect(response.status).toBe(400)
  })
})
