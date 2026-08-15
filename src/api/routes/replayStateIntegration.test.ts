import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
} from "../db/schema/index.ts"
import {
  deepSearchReducer,
  initialDeepSearchState,
} from "../../web/lib/deepSearchState.ts"
import {
  ideaJobReducer,
  initialIdeaJobState,
} from "../../web/pages/Ideas/ideaJobState.ts"
import { reconstructDeepSearchJobEvents } from "./deepSearch/replay.ts"
import { reconstructIdeaJobEvents } from "./ideas/replay.ts"

const stoppedAt = new Date("2026-08-15T10:00:00.000Z")
const terminalAt = new Date("2026-08-15T10:00:01.000Z")
const completedBeforeStopAt = new Date("2026-08-15T09:59:59.000Z")

function replayDeepSearch(deepSearchJobId: string) {
  const events = reconstructDeepSearchJobEvents(deepSearchJobId)
  if (!events) throw new Error("Expected deep-search replay events")
  const state = [
    { type: "opened" as const },
    ...events,
  ].reduce(deepSearchReducer, initialDeepSearchState)
  return { events, state }
}

function replayIdeaJob(ideaJobId: string) {
  const events = reconstructIdeaJobEvents(ideaJobId)
  if (!events) throw new Error("Expected idea-job replay events")
  const state = [
    { type: "opened" as const },
    ...events,
  ].reduce(ideaJobReducer, initialIdeaJobState)
  return { events, state }
}

function insertDeepSearch(values?: {
  deepSearchJobId?: string
  ideaJobId?: string
  status?: "running" | "completed" | "failed" | "interrupted"
  error?: string
  cancelRequestedAt?: Date
  completedAt?: Date
}): string {
  const deepSearchJobId = values?.deepSearchJobId ?? crypto.randomUUID()
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      userId: "test-user-id",
      ideaJobId: values?.ideaJobId,
      ideaJobPosition: values?.ideaJobId ? 0 : undefined,
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research replay state",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      status: values?.status,
      error: values?.error,
      cancelRequestedAt: values?.cancelRequestedAt,
      completedAt: values?.completedAt,
    })
    .run()
  return deepSearchJobId
}

function insertIdeaJob(values?: {
  ideaJobId?: string
  debateJobId?: string
  status?: "running" | "completed" | "failed" | "interrupted"
  error?: string
  cancelRequestedAt?: Date
  completedAt?: Date
}): string {
  const ideaJobId = values?.ideaJobId ?? crypto.randomUUID()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      debateJobId: values?.debateJobId,
      userId: "test-user-id",
      slug: `ideas-${ideaJobId}`,
      prompt: "Generate replay state ideas",
      numberOfIdeas: 6,
      deepSearchCount: 1,
      status: values?.status,
      error: values?.error,
      cancelRequestedAt: values?.cancelRequestedAt,
      completedAt: values?.completedAt,
    })
    .run()
  return ideaJobId
}

describe("durable replay through the browser reducers", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(ideaJobs).run()
    db.delete(llmGenerations).run()
  })

  it("preserves restart-interrupted deep search as Interrupted", () => {
    const deepSearchJobId = insertDeepSearch({
      status: "interrupted",
      error: "Interrupted by a server restart",
      completedAt: terminalAt,
    })

    const { events, state } = replayDeepSearch(deepSearchJobId)

    expect(events).toEqual([
      { type: "interrupted", message: "Interrupted by a server restart" },
      { type: "done" },
    ])
    expect(state).toMatchObject({
      status: "interrupted",
      error: "Interrupted by a server restart",
    })
  })

  it("preserves a completed deep-search child after its debate later stops", () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 42 })
      .run()
    const ideaJobId = insertIdeaJob({ debateJobId })
    const deepSearchJobId = insertDeepSearch({ ideaJobId })
    const finalAnswerGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: finalAnswerGenerationId,
        userId: "test-user-id",
        deepSearchJobId,
        status: "completed",
        text: "Retained completed research",
        reasoning: "Retained reasoning",
        completedAt: completedBeforeStopAt,
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId,
        status: "completed",
        completedAt: completedBeforeStopAt,
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
    db.update(debateJobs)
      .set({ cancelRequestedAt: stoppedAt })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    const { events, state } = replayDeepSearch(deepSearchJobId)

    expect(events).toEqual([
      { type: "final-answer-stream", streamId: finalAnswerGenerationId },
      { type: "done" },
    ])
    expect(state).toMatchObject({
      status: "completed",
      finalAnswerStreamId: finalAnswerGenerationId,
    })
  })

  it("preserves ordinary deep-search failure and direct Stop suffixes", () => {
    const failedId = insertDeepSearch({
      status: "failed",
      error: "Provider failed",
      completedAt: terminalAt,
    })
    const stoppedId = insertDeepSearch({
      status: "interrupted",
      error: "Workflow stopped by user",
      cancelRequestedAt: stoppedAt,
      completedAt: terminalAt,
    })

    const failed = replayDeepSearch(failedId)
    const stopped = replayDeepSearch(stoppedId)

    expect(failed.events).toEqual([
      { type: "error", message: "Provider failed" },
      { type: "done" },
    ])
    expect(failed.state.status).toBe("failed")
    expect(stopped.events).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
    expect(stopped.state.status).toBe("interrupted")
  })

  it("preserves restart-interrupted idea job as Interrupted", () => {
    const ideaJobId = insertIdeaJob({
      status: "interrupted",
      error: "Interrupted by a server restart",
      completedAt: terminalAt,
    })

    const { events, state } = replayIdeaJob(ideaJobId)

    expect(events).toEqual([
      { type: "interrupted", message: "Interrupted by a server restart" },
      { type: "done" },
    ])
    expect(state).toMatchObject({
      status: "interrupted",
      error: "Interrupted by a server restart",
    })
  })

  it("preserves a completed idea child after its debate later stops", () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 42 })
      .run()
    const ideaJobId = insertIdeaJob({ debateJobId })
    const generationIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed" as const,
          text: "Retained completed output",
          reasoning: "Retained reasoning",
          completedAt: completedBeforeStopAt,
        })),
      )
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        researchPromptGenerationId: generationIds[0],
        researchSummaryGenerationId: generationIds[1],
        ideaGenerationId: generationIds[2],
        status: "completed",
        completedAt: completedBeforeStopAt,
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    db.update(debateJobs)
      .set({ cancelRequestedAt: stoppedAt })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    const { events, state } = replayIdeaJob(ideaJobId)

    expect(events).toEqual([
      { type: "research-prompt-stream", streamId: generationIds[0] },
      { type: "research-summary-stream", streamId: generationIds[1] },
      { type: "idea-generation-stream", streamId: generationIds[2] },
      { type: "done" },
    ])
    expect(state).toMatchObject({
      status: "completed",
      researchPromptStreamId: generationIds[0],
      researchSummaryStreamId: generationIds[1],
      ideaGenerationStreamId: generationIds[2],
    })
  })

  it("preserves ordinary idea failure and direct Stop suffixes", () => {
    const failedId = insertIdeaJob({
      status: "failed",
      error: "Planning provider failed",
      completedAt: terminalAt,
    })
    const stoppedId = insertIdeaJob({
      status: "interrupted",
      error: "Workflow stopped by user",
      cancelRequestedAt: stoppedAt,
      completedAt: terminalAt,
    })

    const failed = replayIdeaJob(failedId)
    const stopped = replayIdeaJob(stoppedId)

    expect(failed.events).toEqual([
      {
        type: "error",
        message: "Planning provider failed",
        stage: "planning",
      },
      { type: "done" },
    ])
    expect(failed.state.status).toBe("failed")
    expect(stopped.events).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
    expect(stopped.state.status).toBe("interrupted")
  })
})
