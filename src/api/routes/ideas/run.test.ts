import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
  generateTextStream: vi.fn(),
  startDeepSearch: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
  generateTextStream: mocks.generateTextStream,
}))

import { db } from "../../db/index.ts"
import { ideaJobs, ideas, llmGenerations } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { runIdeaJob } from "./run.ts"
import type { Idea, IdeaJobEvent } from "./schemas.ts"

const researchPrompts = ["Research market constraints", "Research user needs"]
const generatedIdeas: Idea[] = [
  { title: "First idea", description: "First description" },
  { title: "Second idea", description: "Second description" },
]

function insertGeneration(id: string, text: string): void {
  db.insert(llmGenerations)
    .values({
      llmGenerationId: id,
      status: "completed",
      text,
      reasoning: "Test reasoning",
      completedAt: new Date(),
    })
    .run()
}

async function* elements(values: Idea[]): AsyncGenerator<Idea> {
  await Promise.resolve()
  for (const value of values) yield value
}

function setupGenerations(): void {
  insertGeneration("planning-id", JSON.stringify(researchPrompts))
  insertGeneration("summary-id", "Combined research briefing")
  insertGeneration("ideas-id", JSON.stringify(generatedIdeas))
  mocks.generateArrayStream
    .mockResolvedValueOnce({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    .mockResolvedValueOnce({
      id: "ideas-id",
      output: Promise.resolve(generatedIdeas),
      elementStream: elements(generatedIdeas),
    })
  mocks.generateTextStream.mockResolvedValue({ id: "summary-id" })
}

async function collectEvents(
  events: AsyncIterable<IdeaJobEvent>,
): Promise<IdeaJobEvent[]> {
  const result: IdeaJobEvent[] = []
  for await (const event of events) result.push(event)
  return result
}

function createInput(maxRetries?: number) {
  const job = createReplayableEventLog<IdeaJobEvent>()
  const ideaJobId = "11111111-1111-4111-8111-111111111111"
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      prompt: "Generate useful concepts",
      numberOfIdeas: 2,
      deepSearchCount: 2,
    })
    .run()
  const manager: DeepSearchJobManager = {
    start: mocks.startDeepSearch,
    getLiveJob: vi.fn(),
  }
  return {
    input: {
      ideaJobId,
      prompt: "Generate useful concepts",
      numberOfIdeas: 2,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
      ...(maxRetries === undefined ? {} : { maxRetries }),
      job,
      deepSearchManager: manager,
    },
    events: collectEvents(job.subscribe()),
  }
}

describe("runIdeaJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(ideaJobs).run()
    db.delete(llmGenerations).run()
  })

  it("runs all research in parallel before summarising and streams ideas", async () => {
    setupGenerations()
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        completion: Promise.resolve("Second research result"),
      })
    const { input, events } = createInput(0)

    await runIdeaJob(input)

    expect(mocks.startDeepSearch).toHaveBeenCalledTimes(2)
    expect(mocks.startDeepSearch).toHaveBeenNthCalledWith(1, {
      researchRequest: researchPrompts[0],
      maxSearches: 3,
      maxResultsPerSearch: 3,
      ideaJobId: input.ideaJobId,
      maxRetries: 0,
    })
    expect(mocks.generateArrayStream).toHaveBeenCalledTimes(2)
    for (const [generationInput] of mocks.generateArrayStream.mock.calls) {
      expect(generationInput).toEqual(
        expect.objectContaining({ maxRetries: 0 }),
      )
    }
    expect(mocks.generateTextStream).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ maxRetries: 0 }),
    )
    const summaryInput = z.object({ prompt: z.string() }).parse(
      mocks.generateTextStream.mock.calls[0]?.[0] as unknown,
    )
    const ideaInput = z.object({ prompt: z.string() }).parse(
      mocks.generateArrayStream.mock.calls[1]?.[0] as unknown,
    )
    expect(summaryInput.prompt).toContain("<research_text index=")
    expect(ideaInput.prompt).toContain("<research_briefing>")
    await expect(events).resolves.toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-one",
        researchRequest: researchPrompts[0],
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-two",
        researchRequest: researchPrompts[1],
      },
      { type: "research-summary-stream", streamId: "summary-id" },
      { type: "idea-generation-stream", streamId: "ideas-id" },
      { type: "idea", ...generatedIdeas[0] },
      { type: "idea", ...generatedIdeas[1] },
      { type: "done" },
    ])
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "completed",
      error: null,
    })
    expect(
      db.select().from(ideas).orderBy(ideas.position).all(),
    ).toMatchObject(generatedIdeas)
  })

  it("fails the whole pipeline without summarising when any research fails", async () => {
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        completion: Promise.reject(new Error("Second research failed")),
      })
    const { input, events } = createInput()

    await runIdeaJob(input)

    expect(mocks.generateTextStream).not.toHaveBeenCalled()
    expect(mocks.generateArrayStream).toHaveBeenCalledOnce()
    await expect(events).resolves.toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-one",
        researchRequest: researchPrompts[0],
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-two",
        researchRequest: researchPrompts[1],
      },
      {
        type: "error",
        message: "Second research failed",
        stage: "research",
      },
      { type: "done" },
    ])
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Second research failed",
      stage: "research",
    })
  })

  it("persists the stage that fails before its stream is created", async () => {
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        completion: Promise.resolve("Second research result"),
      })
    mocks.generateTextStream.mockRejectedValue(
      new Error("Summary failed before streaming"),
    )
    const { input, events } = createInput()

    await runIdeaJob(input)

    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Summary failed before streaming",
      stage: "summary",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Summary failed before streaming",
      stage: "summary",
    })
  })
})
