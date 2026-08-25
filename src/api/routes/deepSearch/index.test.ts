import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  DeepSearchEvent,
  DeepSearchSearch,
} from "../../agents/deep_search/schemas.ts"
import type { DeepSearchPipelineInput } from "./pipeline.ts"

const mocks = vi.hoisted(() => ({
  deepSearch: vi.fn(),
  generatePromptTitle: vi.fn().mockResolvedValue("Research This"),
}))

vi.mock("./pipeline.ts", () => ({
  runDeepSearchPipeline: mocks.deepSearch,
}))
vi.mock("../../llms/generateText.ts", () => ({
  generatePromptTitle: mocks.generatePromptTitle,
}))

import { db } from "../../db/index.ts"
import {
  debateJobs,
  deepSearchJobs as deepSearchJobsTable,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  deepSearchJobReads,
  deepSearchJobs,
  type DeepSearchJobEvent,
} from "./index.ts"
import { createDeepSearchJobManager } from "./manager.ts"
import { completeDeepSearchJob } from "./jobLifecycle.ts"
import type { ExecutedQuery, SearchRound, SelectedPage } from "./records.ts"
import {
  attachFinalAnswerGeneration,
  attachPageSummaryGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachRoundReviewGeneration,
  attachSelectionGeneration,
  completePageSummaryGeneration,
  completeQuerySummaryGeneration,
  failPageSummaryGeneration,
  failQuerySummaryGeneration,
  savePageFailure,
  savePlannedQueries,
  saveRoundReviewCompletion,
  saveSearchResults,
  saveSelectedResults,
  settlePageExtraction,
} from "./store.ts"
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
  { type: "query-stream", round: 0, streamId: "query-stream-id" },
  { type: "search-results", round: 0, searches },
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
    round: 0,
    query: "test query",
    streamId: "query-summary-stream-id",
  },
  { type: "final-answer-stream", streamId: "final-answer-stream-id" },
]

type MockDeepSearchInput = Pick<
  DeepSearchPipelineInput,
  "deepSearchJobId" | "publish"
>

type PersistedExecution = {
  round: SearchRound
  query: ExecutedQuery
}

type PersistedSelection = PersistedExecution & {
  pages: Map<string, SelectedPage>
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

function getPersistedQueryOutcome(deepSearchJobId: string) {
  return db
    .select({
      status: deepSearchQueries.status,
      errorStage: deepSearchQueries.errorStage,
      errorMessage: deepSearchQueries.errorMessage,
    })
    .from(deepSearchQueries)
    .innerJoin(
      deepSearchRounds,
      eq(deepSearchQueries.deepSearchRoundId, deepSearchRounds.deepSearchRoundId),
    )
    .where(eq(deepSearchRounds.deepSearchJobId, deepSearchJobId))
    .get()
}

function persistSearchExecution(
  input: MockDeepSearchInput,
  params: {
    position: number
    query: string
    results: DeepSearchSearch["results"]
    queryStreamId: string
  },
): PersistedExecution {
  const round = createSearchRound({
    jobId: input.deepSearchJobId,
    position: params.position,
    generationId: params.queryStreamId,
  })
  const [plannedQuery] = savePlannedQueries({
    jobId: input.deepSearchJobId,
    roundId: round.roundId,
    queries: [params.query],
  })
  if (!plannedQuery) throw new Error("Planned query was not persisted")
  input.publish({
    type: "query-stream",
    round: params.position,
    streamId: params.queryStreamId,
  })
  const [query] = saveSearchResults({
    jobId: input.deepSearchJobId,
    roundId: round.roundId,
    searches: [{ plannedQuery, results: params.results }],
  })
  if (!query) throw new Error("Search query was not persisted")
  input.publish({
    type: "search-results",
    round: params.position,
    searches: [{ query: params.query, results: params.results }],
  })
  return { round, query }
}

function persistSelection(
  input: MockDeepSearchInput,
  execution: PersistedExecution,
  streamId: string,
  selectedLinks: string[],
): PersistedSelection {
  attachSelectionGeneration({
    jobId: input.deepSearchJobId,
    queryId: execution.query.queryId,
    generationId: streamId,
  })
  input.publish({
    type: "selection-stream",
    round: execution.round.position,
    query: execution.query.query,
    streamId,
  })
  const selectedUrls = new Set(selectedLinks)
  const pages = saveSelectedResults({
    jobId: input.deepSearchJobId,
    queryId: execution.query.queryId,
    selectionGenerationId: streamId,
    selectedResultIds: execution.query.results
      .filter(({ url }) => selectedUrls.has(url))
      .map(({ resultId }) => resultId),
  })
  input.publish({
    type: "selected-search-results",
    round: execution.round.position,
    query: execution.query.query,
    selectedLinks,
  })
  return { ...execution, pages: new Map(pages.map((page) => [page.url, page])) }
}

function persistPageSummary(
  input: MockDeepSearchInput,
  selection: PersistedSelection,
  params: { url: string; streamId: string; error?: string },
): void {
  const page = selection.pages.get(params.url)
  if (!page) throw new Error("Selected page was not persisted")
  settlePageExtraction({
    userId: "test-user-id",
    jobId: input.deepSearchJobId,
    pageId: page.pageId,
    content: `Extracted content for ${params.url}`,
    creditsUsed: 0,
  })
  db.transaction((transaction) => {
    attachPageSummaryGeneration(transaction, {
      jobId: input.deepSearchJobId,
      pageId: page.pageId,
      generationId: params.streamId,
    })
    if (params.error) {
      failPageSummaryGeneration(transaction, {
        jobId: input.deepSearchJobId,
        pageId: page.pageId,
        generationId: params.streamId,
        message: params.error,
      })
    } else {
      completePageSummaryGeneration(transaction, {
        jobId: input.deepSearchJobId,
        pageId: page.pageId,
        generationId: params.streamId,
      })
    }
  })
  input.publish({
    type: "page-summary-stream",
    url: params.url,
    streamId: params.streamId,
  })
}

function persistPageFailure(
  input: MockDeepSearchInput,
  selection: PersistedSelection,
  params: {
    url: string
    stage: "extraction" | "summary"
    message: string
  },
): void {
  const page = selection.pages.get(params.url)
  if (!page) throw new Error("Selected page was not persisted")
  savePageFailure({
    jobId: input.deepSearchJobId,
    pageId: page.pageId,
    stage: params.stage,
    message: params.message,
  })
  input.publish({ type: "page-summary-error", ...params })
}

function persistQuerySummary(
  input: MockDeepSearchInput,
  execution: PersistedExecution,
  streamId: string,
  error?: string,
): void {
  db.transaction((transaction) => {
    attachQuerySummaryGeneration(transaction, {
      jobId: input.deepSearchJobId,
      queryId: execution.query.queryId,
      generationId: streamId,
    })
    if (error) {
      failQuerySummaryGeneration(transaction, {
        jobId: input.deepSearchJobId,
        queryId: execution.query.queryId,
        generationId: streamId,
        message: error,
      })
    } else {
      completeQuerySummaryGeneration(transaction, {
        jobId: input.deepSearchJobId,
        queryId: execution.query.queryId,
        generationId: streamId,
      })
    }
  })
  input.publish({
    type: "query-summary-stream",
    round: execution.round.position,
    query: execution.query.query,
    streamId,
  })
}

function persistRoundReview(
  input: MockDeepSearchInput,
  execution: PersistedExecution,
  streamId: string,
  review: { decision: "continue" | "stop"; reason: string },
): void {
  db.transaction((transaction) => {
    attachRoundReviewGeneration(transaction, {
      jobId: input.deepSearchJobId,
      roundId: execution.round.roundId,
      generationId: streamId,
    })
    saveRoundReviewCompletion(transaction, {
      jobId: input.deepSearchJobId,
      roundId: execution.round.roundId,
      generationId: streamId,
      review,
    })
  })
  input.publish({
    type: "round-review-stream",
    round: execution.round.position,
    streamId,
  })
  input.publish({
    type: "round-review",
    round: execution.round.position,
    ...review,
  })
}

function persistFinalAnswer(input: MockDeepSearchInput, streamId: string): void {
  db.transaction((transaction) => {
    attachFinalAnswerGeneration(transaction, {
      jobId: input.deepSearchJobId,
      generationId: streamId,
    })
  })
  input.publish({ type: "final-answer-stream", streamId })
}

function persistPrimaryRound(input: MockDeepSearchInput): PersistedSelection {
  const execution = persistSearchExecution(input, {
    position: 0,
    query: searches[0]?.query ?? "test query",
    results: searches[0]?.results ?? [],
    queryStreamId: "query-stream-id",
  })
  return persistSelection(input, execution, "selection-stream-id", [
    "https://example.com",
    "https://example.com/failed",
  ])
}

function emitProgress(
  input: MockDeepSearchInput,
  options: { pageSummaryError?: string } = {},
): void {
  const selection = persistPrimaryRound(input)
  persistPageSummary(input, selection, {
    url: "https://example.com",
    streamId: "summary-stream-id",
    ...(options.pageSummaryError
      ? { error: options.pageSummaryError }
      : {}),
  })
  persistPageFailure(input, selection, {
    url: "https://example.com/failed",
    stage: "extraction",
    message: "Extraction failed",
  })
  persistQuerySummary(input, selection, "query-summary-stream-id")
  persistFinalAnswer(input, "final-answer-stream-id")
}

function completePersistedSearch(input: MockDeepSearchInput): string {
  const finalGeneration = db
    .select({ text: llmGenerations.text })
    .from(llmGenerations)
    .where(
      eq(llmGenerations.llmGenerationId, "final-answer-stream-id"),
    )
    .get()
  if (finalGeneration?.text === null || !finalGeneration) {
    throw new Error("Completed final answer was not persisted")
  }
  db.transaction((transaction) => {
    completeDeepSearchJob(transaction, {
      jobId: input.deepSearchJobId,
      generationId: "final-answer-stream-id",
    })
  })
  return finalGeneration.text
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

function createApp(userId = "test-user-id"): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", userId)
    c.set("viewerUserId", userId)
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

function insertHistoryFixtures(): void {
  db.insert(deepSearchJobsTable)
    .values({
      deepSearchJobId: "manual-job-id",
      userId: "test-user-id",
      title: "Manual Job",
      slug: "manual-job",
      researchRequest: "Manual research",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      strictQuality: false,
    })
    .run()
  db.insert(debateJobs)
    .values({
      debateJobId: "debate-job-id",
      userId: "test-user-id",
      randomSeed: 1,
    })
    .run()
  db.insert(ideaJobs)
    .values([
      {
        ideaJobId: "standalone-idea-job-id",
        userId: "test-user-id",
        prompt: "Standalone ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 3,
        title: "Standalone Idea Title",
        slug: "standalone-idea-slug",
      },
      {
        ideaJobId: "debate-idea-job-id",
        userId: "test-user-id",
        debateJobId: "debate-job-id",
        prompt: "Debate ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 3,
        title: "Debate Idea Title",
        slug: "debate-idea-slug",
      },
    ])
    .run()
  db.insert(deepSearchJobsTable)
    .values([
      {
        deepSearchJobId: "debate-child-id",
        userId: "test-user-id",
        ideaJobId: "debate-idea-job-id",
        ideaJobPosition: 0,
        title: "Debate Child",
        slug: "debate-child",
        researchRequest: "Debate research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: true,
      },
      {
        deepSearchJobId: "standalone-child-id",
        userId: "test-user-id",
        ideaJobId: "standalone-idea-job-id",
        ideaJobPosition: 0,
        title: "Standalone Child",
        slug: "standalone-child",
        researchRequest: "Standalone research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: true,
      },
    ])
    .run()
}

describe("deep search job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(deepSearchJobsTable).run()
    db.delete(llmGenerations).run()
    db.delete(ideaJobs).run()
    db.delete(debateJobs).run()
  })

  it("stops only an owned root and replays the cancellation terminal suffix", async () => {
    const rootId = "00000000-0000-4000-8000-000000000001"
    db.insert(deepSearchJobsTable)
      .values({
        deepSearchJobId: rootId,
        userId: "test-user-id",
        title: "Stoppable search",
        slug: "stoppable-search",
        researchRequest: "Research this",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: false,
      })
      .run()
    const app = createApp()

    const detailBefore = await app.request("/deep-search-jobs/stoppable-search")
    await expect(detailBefore.json()).resolves.toMatchObject({
      deepSearchJob: {
        canResume: false,
        canStop: true,
        stopRequested: false,
      },
    })

    const requested = await app.request(`/deep-search-jobs/${rootId}/cancel`, {
      method: "POST",
    })
    expect(requested.status).toBe(202)
    await expect(requested.json()).resolves.toMatchObject({
      status: "cancellation-requested",
    })

    const repeated = await app.request(`/deep-search-jobs/${rootId}/cancel`, {
      method: "POST",
    })
    expect(repeated.status).toBe(200)

    const alreadyStopped = await app.request(
      `/deep-search-jobs/${rootId}/cancel`,
      { method: "POST" },
    )
    expect(alreadyStopped.status).toBe(200)
    await expect(alreadyStopped.json()).resolves.toMatchObject({
      status: "interrupted",
    })

    const events = await app.request(`/deep-search-jobs/${rootId}/events`)
    await expect(readEvents(events)).resolves.toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
    const detailAfter = await app.request("/deep-search-jobs/stoppable-search")
    await expect(detailAfter.json()).resolves.toMatchObject({
      deepSearchJob: {
        canResume: true,
        canStop: false,
        status: "interrupted",
        stopRequested: true,
      },
    })
  })

  it("resumes one owned root execution for concurrent requests", async () => {
    const deepSearchJobId = "00000000-0000-4000-8000-000000000031"
    db.insert(deepSearchJobsTable)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        title: "Resumable search",
        slug: "resumable-search",
        researchRequest: "Resume this research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
        strictQuality: false,
        status: "interrupted",
        error: "Stopped",
        cancelRequestedAt: new Date(),
        completedAt: new Date(),
      })
      .run()
    mocks.deepSearch.mockImplementation(
      () => new Promise<string>(() => {}),
    )
    const app = createApp()

    const before = await app.request("/deep-search-jobs/resumable-search")
    await expect(before.json()).resolves.toMatchObject({
      deepSearchJob: { canResume: true, canStop: false },
    })
    const responses = await Promise.all([
      app.request(`/deep-search-jobs/${deepSearchJobId}/resume`, {
        method: "POST",
      }),
      app.request(`/deep-search-jobs/${deepSearchJobId}/resume`, {
        method: "POST",
      }),
    ])

    expect(responses.map(({ status }) => status)).toEqual([202, 202])
    await Promise.all(
      responses.map((response) =>
        expect(response.json()).resolves.toEqual({ status: "running" }),
      ),
    )
    await vi.waitFor(() => expect(mocks.deepSearch).toHaveBeenCalledOnce())
    const persisted = db
      .select()
      .from(deepSearchJobsTable)
      .where(eq(deepSearchJobsTable.deepSearchJobId, deepSearchJobId))
      .get()
    expect(persisted).toMatchObject({
      status: "running",
      error: null,
      cancelRequestedAt: null,
      completedAt: null,
    })
  })

  it("returns 404 for unknown or foreign Stop targets and 409 for incompatible jobs", async () => {
    const unknownId = "00000000-0000-4000-8000-000000000099"
    const app = createApp()
    const missing = await app.request(
      `/deep-search-jobs/${unknownId}/cancel`,
      { method: "POST" },
    )
    expect(missing.status).toBe(404)
    const missingResume = await app.request(
      `/deep-search-jobs/${unknownId}/resume`,
      { method: "POST" },
    )
    expect(missingResume.status).toBe(404)

    db.insert(ideaJobs)
      .values({
        ideaJobId: "child-owner",
        userId: "test-user-id",
        prompt: "Ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 3,
      })
      .run()
    const childId = "00000000-0000-4000-8000-000000000002"
    db.insert(deepSearchJobsTable)
      .values({
        deepSearchJobId: childId,
        userId: "test-user-id",
        ideaJobId: "child-owner",
        ideaJobPosition: 0,
        title: "Child",
        slug: "child",
        researchRequest: "Research this",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: true,
      })
      .run()
    const child = await app.request(`/deep-search-jobs/${childId}/cancel`, {
      method: "POST",
    })
    expect(child.status).toBe(409)
    const childResume = await app.request(
      `/deep-search-jobs/${childId}/resume`,
      { method: "POST" },
    )
    expect(childResume.status).toBe(409)
    const foreign = await createApp("foreign-user").request(
      `/deep-search-jobs/${childId}/cancel`,
      { method: "POST" },
    )
    expect(foreign.status).toBe(404)
    const foreignResume = await createApp("foreign-user").request(
      `/deep-search-jobs/${childId}/resume`,
      { method: "POST" },
    )
    expect(foreignResume.status).toBe(404)

    const failedId = "00000000-0000-4000-8000-000000000003"
    db.insert(deepSearchJobsTable)
      .values({
        deepSearchJobId: failedId,
        userId: "test-user-id",
        title: "Failed",
        slug: "failed-stop-target",
        researchRequest: "Research this",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: false,
        status: "failed",
        error: "Provider failed",
        completedAt: new Date(),
      })
      .run()
    const failed = await app.request(`/deep-search-jobs/${failedId}/cancel`, {
      method: "POST",
    })
    expect(failed.status).toBe(409)
  })

  it("returns a durable job ID and retains all published events", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      prepareProgressGenerations(input.deepSearchJobId)
      emitProgress(input)
      return Promise.resolve(completePersistedSearch(input))
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

  it("splits history between manual and automated jobs with their origin", async () => {
    insertHistoryFixtures()
    const app = createApp()

    const manual = await app.request("/deep-search-jobs")
    await expect(manual.json()).resolves.toMatchObject({
      deepSearchJobs: [
        { deepSearchJobId: "manual-job-id", title: "Manual Job", origin: null },
      ],
    })

    const automated = await app.request("/deep-search-jobs?source=automated")
    await expect(automated.json()).resolves.toMatchObject({
      deepSearchJobs: [
        {
          deepSearchJobId: "standalone-child-id",
          origin: {
            kind: "idea",
            title: "Standalone Idea Title",
            slug: "standalone-idea-slug",
          },
        },
        {
          deepSearchJobId: "debate-child-id",
          origin: {
            kind: "debate",
            title: "Debate Idea Title",
            slug: "debate-idea-slug",
          },
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
      maxRounds: 2,
    })

    expect(created.status).toBe(202)
    expect(mocks.deepSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        researchRequest: "Research this",
        maxSearches: 5,
        maxResultsPerSearch: 2,
        maxRounds: 2,
      }),
    )
  })

  it("rejects requests above the per-round selected-URL budget", async () => {
    const response = await createJob(createApp(), {
      researchRequest: "Research this",
      maxSearches: 10,
      maxResultsPerSearch: 4,
    })

    expect(response.status).toBe(400)
    expect(mocks.generatePromptTitle).not.toHaveBeenCalled()
    expect(mocks.deepSearch).not.toHaveBeenCalled()
  })

  it("follows events published after subscription", async () => {
    const completion = Promise.withResolvers<void>()
    const inputReady = Promise.withResolvers<MockDeepSearchInput>()
    mocks.deepSearch.mockImplementation(async (next: MockDeepSearchInput) => {
      inputReady.resolve(next)
      await completion.promise
      return completePersistedSearch(next)
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
      return Promise.resolve(completePersistedSearch(input))
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

  it("reconstructs every persisted round and its exploration decision", async () => {
    const firstSearch = {
      query: "first query",
      results: [
        {
          title: "First result",
          shortText: "First evidence",
          link: "https://example.com/first",
        },
      ],
    }
    const secondSearch = {
      query: "second query",
      results: [
        {
          title: "Second result",
          shortText: "Second evidence",
          link: "https://example.com/second",
        },
      ],
    }
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      for (const streamId of [
        "query-stream-0",
        "selection-stream-0",
        "query-summary-stream-0",
        "review-stream-0",
        "query-stream-1",
        "selection-stream-1",
        "query-summary-stream-1",
        "final-answer-stream-id",
      ]) {
        insertCompletedGeneration(input.deepSearchJobId, streamId)
      }

      const firstExecution = persistSearchExecution(input, {
        position: 0,
        query: firstSearch.query,
        results: firstSearch.results,
        queryStreamId: "query-stream-0",
      })
      const firstSelection = persistSelection(
        input,
        firstExecution,
        "selection-stream-0",
        [],
      )
      persistQuerySummary(input, firstSelection, "query-summary-stream-0")
      persistRoundReview(input, firstSelection, "review-stream-0", {
        decision: "continue",
        reason: "A material evidence gap remains.",
      })

      const secondExecution = persistSearchExecution(input, {
        position: 1,
        query: secondSearch.query,
        results: secondSearch.results,
        queryStreamId: "query-stream-1",
      })
      const secondSelection = persistSelection(
        input,
        secondExecution,
        "selection-stream-1",
        [],
      )
      persistQuerySummary(input, secondSelection, "query-summary-stream-1")
      persistFinalAnswer(input, "final-answer-stream-id")
      return Promise.resolve(completePersistedSearch(input))
    })
    const app = createApp()
    const created = await createJob(app, {
      researchRequest: "Research this",
      maxRounds: 2,
    })
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    const replayed = await createApp().request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    await expect(readEvents(replayed)).resolves.toEqual([
      {
        type: "query-stream",
        round: 0,
        streamId: "query-stream-0",
      },
      { type: "search-results", round: 0, searches: [firstSearch] },
      {
        type: "selection-stream",
        round: 0,
        query: firstSearch.query,
        streamId: "selection-stream-0",
      },
      {
        type: "selected-search-results",
        round: 0,
        query: firstSearch.query,
        selectedLinks: [],
      },
      {
        type: "query-stream",
        round: 1,
        streamId: "query-stream-1",
      },
      { type: "search-results", round: 1, searches: [secondSearch] },
      {
        type: "selection-stream",
        round: 1,
        query: secondSearch.query,
        streamId: "selection-stream-1",
      },
      {
        type: "selected-search-results",
        round: 1,
        query: secondSearch.query,
        selectedLinks: [],
      },
      {
        type: "query-summary-stream",
        round: 0,
        query: firstSearch.query,
        streamId: "query-summary-stream-0",
      },
      {
        type: "round-review-stream",
        round: 0,
        streamId: "review-stream-0",
      },
      {
        type: "round-review",
        round: 0,
        decision: "continue",
        reason: "A material evidence gap remains.",
      },
      {
        type: "query-summary-stream",
        round: 1,
        query: secondSearch.query,
        streamId: "query-summary-stream-1",
      },
      {
        type: "final-answer-stream",
        streamId: "final-answer-stream-id",
      },
      { type: "done" },
    ])
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

  it("does not replay search results when planned web searches never completed", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      insertCompletedGeneration(input.deepSearchJobId, "query-stream-id")
      const round = createSearchRound({
        jobId: input.deepSearchJobId,
        position: 0,
        generationId: "query-stream-id",
      })
      savePlannedQueries({
        jobId: input.deepSearchJobId,
        roundId: round.roundId,
        queries: ["test query"],
      })
      input.publish({
        type: "query-stream",
        round: 0,
        streamId: "query-stream-id",
      })
      return Promise.reject(new Error("Web search failed"))
    })
    const created = await createJob(createApp())
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    const replayed = await createApp().request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    await expect(readEvents(replayed)).resolves.toEqual([
      { type: "query-stream", round: 0, streamId: "query-stream-id" },
      { type: "error", message: "Web search failed" },
      { type: "done" },
    ])
  })

  it("persists a selection-stage failure and prevents dependent events", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      insertCompletedGeneration(input.deepSearchJobId, "query-stream-id")
      insertFailedGeneration(
        input.deepSearchJobId,
        "selection-stream-id",
        "Source selection failed",
      )
      const execution = persistSearchExecution(input, {
        position: 0,
        query: searches[0]?.query ?? "test query",
        results: searches[0]?.results ?? [],
        queryStreamId: "query-stream-id",
      })
      attachSelectionGeneration({
        jobId: input.deepSearchJobId,
        queryId: execution.query.queryId,
        generationId: "selection-stream-id",
      })
      input.publish({
        type: "selection-stream",
        round: 0,
        query: "test query",
        streamId: "selection-stream-id",
      })
      return Promise.reject(new Error("Source selection failed"))
    })
    const app = createApp()
    const created = await createJob(app)
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }

    const subscribed = await app.request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    await expect(readEvents(subscribed)).resolves.toEqual([
      ...progressEvents.slice(0, 3),
      { type: "error", message: "Source selection failed" },
      { type: "done" },
    ])
    expect(getPersistedQueryOutcome(deepSearchJobId)).toEqual({
      status: "failed",
      errorStage: "selection",
      errorMessage: "Source selection failed",
    })
  })

  it("persists a query-summary failure without registering a final answer", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      for (const streamId of [
        "query-stream-id",
        "selection-stream-id",
        "summary-stream-id",
      ]) {
        insertCompletedGeneration(input.deepSearchJobId, streamId)
      }
      insertFailedGeneration(
        input.deepSearchJobId,
        "query-summary-stream-id",
        "Query summary failed",
      )
      const selection = persistPrimaryRound(input)
      persistPageSummary(input, selection, {
        url: "https://example.com",
        streamId: "summary-stream-id",
      })
      persistPageFailure(input, selection, {
        url: "https://example.com/failed",
        stage: "extraction",
        message: "Extraction failed",
      })
      persistQuerySummary(
        input,
        selection,
        "query-summary-stream-id",
        "Query summary failed",
      )
      return Promise.reject(new Error("Query summary failed"))
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

    const events = await readEvents(subscribed)
    expect(events.slice(0, 4)).toEqual(progressEvents.slice(0, 4))
    expect(events.slice(4, 6)).toEqual(
      expect.arrayContaining(progressEvents.slice(4, 6)),
    )
    expect(events.slice(6)).toEqual([
      progressEvents[6],
      { type: "error", message: "Query summary failed" },
      { type: "done" },
    ])
    expect(getPersistedQueryOutcome(deepSearchJobId)).toEqual({
      status: "failed",
      errorStage: "summary",
      errorMessage: "Query summary failed",
    })
    const detail = await app.request(`/deep-search-jobs/${slug}`)
    await expect(detail.json()).resolves.toMatchObject({
      deepSearchJob: {
        finalAnswerGenerationId: null,
        status: "failed",
        error: "Query summary failed",
      },
    })
  })

  it("replays completed selection when summary setup fails before registration", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      insertCompletedGeneration(input.deepSearchJobId, "query-stream-id")
      insertCompletedGeneration(input.deepSearchJobId, "selection-stream-id")
      persistPrimaryRound(input)
      return Promise.reject(new Error("Summary setup failed"))
    })
    const created = await createJob(createApp())
    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    const replayed = await createApp().request(
      `/deep-search-jobs/${deepSearchJobId}/events`,
    )

    const events = await readEvents(replayed)
    expect(events.slice(0, 4)).toEqual(progressEvents.slice(0, 4))
    expect(events.slice(4, 6)).toEqual(
      expect.arrayContaining([
        {
          type: "page-summary-error",
          url: "https://example.com/failed",
          stage: "extraction",
          message: "Summary setup failed",
        },
        {
          type: "page-summary-error",
          url: "https://example.com",
          stage: "extraction",
          message: "Summary setup failed",
        },
      ]),
    )
    expect(events.slice(6)).toEqual([
      { type: "error", message: "Summary setup failed" },
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
      return Promise.reject(new Error("Final answer generation failed"))
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

  it("completes with snippet fallback when a page-summary generation fails", async () => {
    mocks.deepSearch.mockImplementation((input: MockDeepSearchInput) => {
      for (const streamId of [
        "query-stream-id",
        "selection-stream-id",
        "query-summary-stream-id",
        "final-answer-stream-id",
      ]) {
        insertCompletedGeneration(input.deepSearchJobId, streamId)
      }
      insertFailedGeneration(
        input.deepSearchJobId,
        "summary-stream-id",
        "Page summary generation failed",
      )
      emitProgress(input, {
        pageSummaryError: "Page summary generation failed",
      })
      return Promise.resolve(completePersistedSearch(input))
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

    expectDurableProgress(await readEvents(subscribed), [{ type: "done" }])
    const detail = await app.request(`/deep-search-jobs/${slug}`)
    await expect(detail.json()).resolves.toMatchObject({
      deepSearchJob: {
        deepSearchJobId,
        status: "completed",
        error: null,
      },
    })
    expect(
      db
        .select({
          status: deepSearchWebPages.status,
          errorStage: deepSearchWebPages.errorStage,
          errorMessage: deepSearchWebPages.errorMessage,
        })
        .from(deepSearchWebPages)
        .where(
          eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        {
          status: "failed",
          errorStage: "summary",
          errorMessage: "Page summary generation failed",
        },
      ]),
    )
  })

  it("terminates with an error when terminal job persistence fails", async () => {
    const completion = Promise.withResolvers<void>()
    const inputReady = Promise.withResolvers<MockDeepSearchInput>()
    mocks.deepSearch.mockImplementation(async (input: MockDeepSearchInput) => {
      inputReady.resolve(input)
      await completion.promise
      return completePersistedSearch(input)
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
    persistFinalAnswer(input, "final-answer-stream-id")
    const transaction = vi.spyOn(db, "transaction").mockImplementation(() => {
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
      transaction.mockRestore()
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
