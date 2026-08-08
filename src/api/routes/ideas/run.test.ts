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

const researchPrompts = [
  { title: "Market Constraints", prompt: "Research market constraints" },
  { title: "User Needs", prompt: "Research user needs" },
]
const ideaJobId = "11111111-1111-4111-8111-111111111111"
const generatedIdeas: Idea[] = [
  { title: "First idea", description: "First description" },
  { title: "Second idea", description: "Second description" },
]

function insertGeneration(id: string, text: string): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      ideaJobId,
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
  insertGeneration("critique-one-id", "First critique")
  insertGeneration("critique-two-id", "Second critique")
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
  mocks.generateTextStream
    .mockResolvedValueOnce({ id: "summary-id" })
    .mockResolvedValueOnce({ id: "critique-one-id" })
    .mockResolvedValueOnce({ id: "critique-two-id" })
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
  db.insert(ideaJobs)
    .values({
      userId: "test-user-id",
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
      userId: "test-user-id",
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

  it("runs research and one critique generation per idea", async () => {
    const { input, events } = createInput(0)
    setupGenerations()
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        title: "User Needs",
        slug: "user-needs",
        completion: Promise.resolve("Second research result"),
      })
    await runIdeaJob(input)

    expect(mocks.startDeepSearch).toHaveBeenCalledTimes(2)
    expect(mocks.startDeepSearch).toHaveBeenNthCalledWith(
      1,
      "test-user-id",
      {
        title: researchPrompts[0].title,
        researchRequest: researchPrompts[0].prompt,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        ideaJobId: input.ideaJobId,
        ideaJobPosition: 0,
        maxRetries: 0,
      },
    )
    expect(mocks.generateArrayStream).toHaveBeenCalledTimes(2)
    for (const [generationInput] of mocks.generateArrayStream.mock.calls) {
      expect(generationInput).toEqual(
        expect.objectContaining({ maxRetries: 0 }),
      )
    }
    expect(mocks.generateTextStream).toHaveBeenCalledTimes(3)
    for (const [generationInput] of mocks.generateTextStream.mock.calls) {
      expect(generationInput).toEqual(
        expect.objectContaining({ maxRetries: 0 }),
      )
    }
    const summaryInput = z.object({ prompt: z.string() }).parse(
      mocks.generateTextStream.mock.calls[0]?.[0] as unknown,
    )
    const ideaInput = z.object({ prompt: z.string() }).parse(
      mocks.generateArrayStream.mock.calls[1]?.[0] as unknown,
    )
    const critiqueInputs = mocks.generateTextStream.mock.calls
      .slice(1)
      .map(([value]) =>
        z.object({ prompt: z.string() }).parse(value as unknown),
      )
    expect(summaryInput.prompt).toContain("<research_text index=")
    expect(ideaInput.prompt).toContain("<research_briefing>")
    expect(critiqueInputs).toHaveLength(generatedIdeas.length)
    for (const [position, critiqueInput] of critiqueInputs.entries()) {
      expect(critiqueInput.prompt).toContain("<research_briefing>")
      expect(critiqueInput.prompt).toContain(
        `<generated_idea>\n${JSON.stringify(generatedIdeas[position])}\n</generated_idea>`,
      )
    }
    await expect(events).resolves.toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        researchRequest: researchPrompts[0].prompt,
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-two",
        title: "User Needs",
        slug: "user-needs",
        researchRequest: researchPrompts[1].prompt,
      },
      { type: "research-summary-stream", streamId: "summary-id" },
      { type: "idea-generation-stream", streamId: "ideas-id" },
      { type: "idea", ...generatedIdeas[0] },
      { type: "idea", ...generatedIdeas[1] },
      {
        type: "critique-generation-stream",
        position: 0,
        streamId: "critique-one-id",
      },
      {
        type: "critique-generation-stream",
        position: 1,
        streamId: "critique-two-id",
      },
      { type: "done" },
    ])
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "completed",
      stage: "ideas",
      error: null,
    })
    expect(db.select().from(ideas).orderBy(ideas.position).all()).toMatchObject([
      { ...generatedIdeas[0], critiqueGenerationId: "critique-one-id" },
      { ...generatedIdeas[1], critiqueGenerationId: "critique-two-id" },
    ])
  })

  it("fails the whole pipeline without summarising when any research fails", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        title: "User Needs",
        slug: "user-needs",
        completion: Promise.reject(new Error("Second research failed")),
      })
    await runIdeaJob(input)

    expect(mocks.generateTextStream).not.toHaveBeenCalled()
    expect(mocks.generateArrayStream).toHaveBeenCalledOnce()
    await expect(events).resolves.toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        researchRequest: researchPrompts[0].prompt,
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "search-two",
        title: "User Needs",
        slug: "user-needs",
        researchRequest: researchPrompts[1].prompt,
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
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        title: "User Needs",
        slug: "user-needs",
        completion: Promise.resolve("Second research result"),
      })
    mocks.generateTextStream.mockRejectedValue(
      new Error("Summary failed before streaming"),
    )
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

  it("retains generated ideas when one critique cannot start", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    insertGeneration("summary-id", "Combined research briefing")
    insertGeneration("ideas-id", JSON.stringify(generatedIdeas))
    insertGeneration("critique-two-id", "Second critique")
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
    mocks.generateTextStream
      .mockResolvedValueOnce({ id: "summary-id" })
      .mockRejectedValueOnce(new Error("Critique failed before streaming"))
      .mockResolvedValueOnce({ id: "critique-two-id" })
    mocks.startDeepSearch
      .mockReturnValueOnce({
        deepSearchJobId: "search-one",
        completion: Promise.resolve("First research result"),
      })
      .mockReturnValueOnce({
        deepSearchJobId: "search-two",
        completion: Promise.resolve("Second research result"),
      })

    await runIdeaJob(input)

    expect(mocks.generateTextStream).toHaveBeenCalledTimes(3)
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Critique failed before streaming",
      stage: "critique",
    })
    await expect(events).resolves.toContainEqual({
      type: "critique-generation-stream",
      position: 1,
      streamId: "critique-two-id",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Critique failed before streaming",
      stage: "ideas",
    })
    expect(db.select().from(ideas).orderBy(ideas.position).all()).toMatchObject([
      { ...generatedIdeas[0], critiqueGenerationId: null },
      { ...generatedIdeas[1], critiqueGenerationId: "critique-two-id" },
    ])
  })
})
