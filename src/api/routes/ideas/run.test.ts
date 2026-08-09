import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
  generateObjectStream: vi.fn(),
  generateTextStream: vi.fn(),
  startDeepSearch: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
  generateObjectStream: mocks.generateObjectStream,
  generateTextStream: mocks.generateTextStream,
}))

import { db } from "../../db/index.ts"
import { ideaJobs, ideas, llmGenerations } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import { runIdeaJob } from "./run.ts"
import type { Idea, IdeaJobEvent } from "./schemas.ts"

type SelectionOutput = { selectedIdeaIds: string[] }
type SelectionMockInput = {
  schema: z.ZodType<SelectionOutput>
  onCompleted?: (
    result: { id: string; output: SelectionOutput },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

const researchPrompts = [
  { title: "Market Constraints", prompt: "Research market constraints" },
  { title: "User Needs", prompt: "Research user needs" },
]
const ideaJobId = "11111111-1111-4111-8111-111111111111"
const generatedIdeas: Idea[] = [
  { title: "First idea", description: "First description" },
  { title: "Second idea", description: "Second description" },
  { title: "Third idea", description: "Third description" },
  { title: "Fourth idea", description: "Fourth description" },
  { title: "Fifth idea", description: "Fifth description" },
  { title: "Sixth idea", description: "Sixth description" },
  { title: "Seventh idea", description: "Seventh description" },
  { title: "Eighth idea", description: "Eighth description" },
]
const critiqueGenerationIds = generatedIdeas.map(
  (_, position) => `critique-${position + 1}-id`,
)

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
  for (const [position, id] of critiqueGenerationIds.entries()) {
    insertGeneration(id, `Critique ${position + 1}`)
  }
  insertGeneration("selection-id", '{"selectedIdeaIds":[]}')
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
  for (const id of critiqueGenerationIds) {
    mocks.generateTextStream.mockResolvedValueOnce({ id })
  }
  mocks.generateObjectStream.mockImplementationOnce(
    ({ onCompleted, schema }: SelectionMockInput) => {
      const selectedIdeaIds = db
        .select({ ideaId: ideas.ideaId })
        .from(ideas)
        .orderBy(ideas.position)
        .all()
        .slice(0, 6)
        .map(({ ideaId }) => ideaId)
      const output = schema.parse({ selectedIdeaIds })
      db.transaction((transaction) => {
        onCompleted?.({ id: "selection-id", output }, transaction)
      })
      return Promise.resolve({
        id: "selection-id",
        output: Promise.resolve(output),
      })
    },
  )
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
      numberOfIdeas: 8,
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
      numberOfIdeas: 8,
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

  it("runs research, critiques every idea, and selects an admitted set", async () => {
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
    expect(mocks.generateTextStream).toHaveBeenCalledTimes(
      generatedIdeas.length + 1,
    )
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
    expect(mocks.generateObjectStream).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        reasoning: "enabled",
      }),
    )
    const selectionInput = z.object({ prompt: z.string() }).parse(
      mocks.generateObjectStream.mock.calls[0]?.[0] as unknown,
    )
    expect(selectionInput.prompt).toContain("<research_briefing>")
    for (let position = 0; position < generatedIdeas.length; position += 1) {
      expect(selectionInput.prompt).toContain(`Critique ${position + 1}`)
    }
    const persistedIdeas = db.select().from(ideas).orderBy(ideas.position).all()
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
      ...persistedIdeas.map(({ ideaId, title, description }) => ({
        type: "idea" as const,
        ideaId,
        title,
        description,
      })),
      ...critiqueGenerationIds.map((streamId, position) => ({
        type: "critique-generation-stream" as const,
        position,
        streamId,
      })),
      { type: "idea-selection-stream", streamId: "selection-id" },
      {
        type: "selected-ideas",
        selectedIdeaIds: persistedIdeas
          .slice(0, 6)
          .map(({ ideaId }) => ideaId),
      },
      { type: "done" },
    ])
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "completed",
      stage: "ideas",
      error: null,
      selectionGenerationId: "selection-id",
    })
    expect(persistedIdeas).toMatchObject(
      generatedIdeas.map((idea, position) => ({
        ...idea,
        critiqueGenerationId: critiqueGenerationIds[position],
        selected: position < 6,
      })),
    )
    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual(
      expect.arrayContaining([
        { type: "idea-selection-stream", streamId: "selection-id" },
        {
          type: "selected-ideas",
          selectedIdeaIds: persistedIdeas
            .slice(0, 6)
            .map(({ ideaId }) => ideaId),
        },
        { type: "done" },
      ]),
    )
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

  it("waits for started sibling research when another child cannot start", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      elementStream: elements([]),
    })
    let finishFirstResearch!: (value: string) => void
    const firstCompletion = new Promise<string>((resolve) => {
      finishFirstResearch = resolve
    })
    mocks.startDeepSearch
      .mockResolvedValueOnce({
        deepSearchJobId: "search-one",
        title: "Market Constraints",
        slug: "market-constraints",
        completion: firstCompletion,
      })
      .mockRejectedValueOnce(new Error("Second research could not start"))

    const running = runIdeaJob(input)
    await vi.waitFor(() => {
      expect(mocks.startDeepSearch).toHaveBeenCalledTimes(2)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "running",
      stage: "research",
    })

    finishFirstResearch("First research result")
    await running

    expect(mocks.generateTextStream).not.toHaveBeenCalled()
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
        type: "error",
        message: "Second research could not start",
        stage: "research",
      },
      { type: "done" },
    ])
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Second research could not start",
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
    for (const [position, id] of critiqueGenerationIds.slice(1).entries()) {
      insertGeneration(id, `Critique ${position + 2}`)
    }
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
    for (const id of critiqueGenerationIds.slice(1)) {
      mocks.generateTextStream.mockResolvedValueOnce({ id })
    }
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

    expect(mocks.generateTextStream).toHaveBeenCalledTimes(
      generatedIdeas.length + 1,
    )
    expect(mocks.generateObjectStream).not.toHaveBeenCalled()
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Critique failed before streaming",
      stage: "critique",
    })
    await expect(events).resolves.toContainEqual({
      type: "critique-generation-stream",
      position: 1,
      streamId: critiqueGenerationIds[1],
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Critique failed before streaming",
      stage: "ideas",
    })
    expect(db.select().from(ideas).orderBy(ideas.position).all()).toMatchObject(
      generatedIdeas.map((idea, position) => ({
        ...idea,
        critiqueGenerationId:
          position === 0 ? null : critiqueGenerationIds[position],
      })),
    )
  })
})
