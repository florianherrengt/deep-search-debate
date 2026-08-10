import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
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
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import { runIdeaJob } from "./run.ts"
import type { Idea, IdeaJobEvent } from "./schemas.ts"

type SelectionOutput = { selectedIdeaIds: string[] }
type SelectionMockInput = {
  prompt: string
  schema: z.ZodType<SelectionOutput>
  onCompleted?: (
    result: { id: string; output: SelectionOutput },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

type RefinementMockInput = {
  prompt: string
  schema: z.ZodType<Idea>
  onCompleted?: (
    result: { id: string; output: Idea },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

type StartSearchInput = {
  title?: string
  researchRequest: string
  maxSearches: number
  maxResultsPerSearch: number
  ideaJobId?: string
  ideaJobPosition?: number
  maxRetries?: number
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
const refinementGenerationIds = generatedIdeas
  .slice(0, 6)
  .map((_, position) => `refinement-${position + 1}-id`)

function expectedRefinedIdeaResearchRequest(position: number): string {
  return [
    "Research this proposed idea in relation to the user's request. Investigate relevant evidence, comparable approaches, feasibility, risks, and practical implementation considerations.",
    "<user_request>",
    "Generate useful concepts",
    "</user_request>",
    "<refined_idea>",
    JSON.stringify({
      title: `Improved ${generatedIdeas[position].title}`,
      description: `Improved ${generatedIdeas[position].description}`,
    }),
    "</refined_idea>",
  ].join("\n")
}

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

function setupGenerations(options?: { refinementFailureAt?: number }): void {
  insertGeneration("planning-id", JSON.stringify(researchPrompts))
  insertGeneration("summary-id", "Combined research briefing")
  insertGeneration("ideas-id", JSON.stringify(generatedIdeas))
  for (const [position, id] of critiqueGenerationIds.entries()) {
    insertGeneration(id, `Critique ${position + 1}`)
  }
  insertGeneration("selection-id", '{"selectedIdeaIds":[]}')
  for (const [position, id] of refinementGenerationIds.entries()) {
    insertGeneration(
      id,
      JSON.stringify({
        title: `Improved ${generatedIdeas[position].title}`,
        description: `Improved ${generatedIdeas[position].description}`,
      }),
    )
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
  for (const id of critiqueGenerationIds) {
    mocks.generateTextStream.mockResolvedValueOnce({ id })
  }
  let refinementPosition = 0
  mocks.generateObjectStream.mockImplementation(
    (rawInput: SelectionMockInput | RefinementMockInput) => {
      if (!rawInput.prompt.includes("<original_idea>")) {
        const { onCompleted, schema } = rawInput as SelectionMockInput
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
      }

      const { onCompleted, schema } = rawInput as RefinementMockInput
      const position = refinementPosition
      refinementPosition += 1
      if (position === options?.refinementFailureAt) {
        return Promise.reject(
          new Error("Refinement failed before streaming"),
        )
      }
      const id = refinementGenerationIds[position]
      const output = schema.parse({
        title: `Improved ${generatedIdeas[position].title}`,
        description: `Improved ${generatedIdeas[position].description}`,
      })
      return Promise.resolve({
        id,
        output: new Promise<Idea>((resolve) => {
          setTimeout(() => {
            db.transaction((transaction) => {
              onCompleted?.({ id, output }, transaction)
            })
            resolve(output)
          }, 0)
        }),
      })
    },
  )
}

function persistCompletedSearch(
  id: string,
  input: StartSearchInput,
): {
  deepSearchJobId: string
  title: string
  slug: string
  completion: Promise<string>
} {
  const title = input.title ?? `Search ${input.ideaJobPosition ?? 0}`
  const slug =
    id === "search-one"
      ? "market-constraints"
      : id === "search-two"
        ? "user-needs"
        : id
  const finalAnswerGenerationId = `${id}-answer`
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId: id,
      userId: "test-user-id",
      ideaJobId: input.ideaJobId,
      ideaJobPosition: input.ideaJobPosition,
      title,
      slug,
      researchRequest: input.researchRequest,
      maxSearches: input.maxSearches,
      maxResultsPerSearch: input.maxResultsPerSearch,
    })
    .run()
  db.insert(llmGenerations)
    .values({
      llmGenerationId: finalAnswerGenerationId,
      userId: "test-user-id",
      deepSearchJobId: id,
      status: "completed",
      text: `Research answer for ${title}`,
      reasoning: "Test reasoning",
      completedAt: new Date(),
    })
    .run()
  db.update(deepSearchJobs)
    .set({
      finalAnswerGenerationId,
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(deepSearchJobs.deepSearchJobId, id))
    .run()
  return {
    deepSearchJobId: id,
    title,
    slug,
    completion: Promise.resolve(`Research answer for ${title}`),
  }
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
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        const id =
          position === 0
            ? "search-one"
            : position === 1
              ? "search-two"
              : `idea-search-${position}`
        return Promise.resolve(persistCompletedSearch(id, searchInput))
      },
    )
    await runIdeaJob(input)

    expect(mocks.startDeepSearch).toHaveBeenCalledTimes(8)
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
        z
          .object({
            prompt: z.string(),
            reasoning: z.literal("disabled"),
          })
          .parse(value as unknown),
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
    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(7)
    const selectionInput = z.object({ prompt: z.string() }).parse(
      mocks.generateObjectStream.mock.calls[0]?.[0] as unknown,
    )
    expect(selectionInput.prompt).toContain("<research_briefing>")
    for (let position = 0; position < generatedIdeas.length; position += 1) {
      expect(selectionInput.prompt).toContain(`Critique ${position + 1}`)
    }
    const refinementInputs = mocks.generateObjectStream.mock.calls
      .slice(1)
      .map(([value]) =>
        z.object({ prompt: z.string() }).parse(value as unknown),
      )
    expect(refinementInputs).toHaveLength(6)
    for (const [position, refinementInput] of refinementInputs.entries()) {
      expect(refinementInput.prompt).toContain("<research_briefing>")
      expect(refinementInput.prompt).toContain(`Critique ${position + 1}`)
      expect(refinementInput.prompt).toContain(
        `<original_idea>\n${JSON.stringify(generatedIdeas[position])}\n</original_idea>`,
      )
    }
    const persistedIdeas = db.select().from(ideas).orderBy(ideas.position).all()
    const selectedIdeas = persistedIdeas.slice(0, 6)
    for (const [position, idea] of selectedIdeas.entries()) {
      expect(mocks.startDeepSearch).toHaveBeenNthCalledWith(
        position + 3,
        "test-user-id",
        expect.objectContaining({
          title: `Improved ${generatedIdeas[position].title}`,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          ideaJobId: input.ideaJobId,
          ideaJobPosition: position + 2,
          maxRetries: 0,
          researchRequest: expectedRefinedIdeaResearchRequest(position),
        }),
      )
      expect(idea).toMatchObject({
        refinementGenerationId: refinementGenerationIds[position],
        refinedTitle: `Improved ${generatedIdeas[position].title}`,
        refinedDescription: `Improved ${generatedIdeas[position].description}`,
        deepSearchJobId: `idea-search-${position + 2}`,
      })
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
        selectedIdeaIds: selectedIdeas.map(({ ideaId }) => ideaId),
      },
      ...selectedIdeas.map(({ ideaId }, position) => ({
        type: "idea-refinement-stream" as const,
        ideaId,
        streamId: refinementGenerationIds[position],
      })),
      ...selectedIdeas.map(({ ideaId }, position) => ({
        type: "refined-idea" as const,
        ideaId,
        title: `Improved ${generatedIdeas[position].title}`,
        description: `Improved ${generatedIdeas[position].description}`,
      })),
      ...selectedIdeas.map(({ ideaId }, position) => ({
        type: "idea-deep-search-started" as const,
        ideaId,
        deepSearchJobId: `idea-search-${position + 2}`,
        title: `Improved ${generatedIdeas[position].title}`,
        slug: `idea-search-${position + 2}`,
        researchRequest: expectedRefinedIdeaResearchRequest(position),
      })),
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
        refinementGenerationId:
          position < 6 ? refinementGenerationIds[position] : null,
        refinedTitle: position < 6 ? `Improved ${idea.title}` : null,
        refinedDescription:
          position < 6 ? `Improved ${idea.description}` : null,
        deepSearchJobId:
          position < 6 ? `idea-search-${position + 2}` : null,
      })),
    )
    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual(
      expect.arrayContaining([
        { type: "idea-selection-stream", streamId: "selection-id" },
        {
          type: "selected-ideas",
          selectedIdeaIds: selectedIdeas.map(({ ideaId }) => ideaId),
        },
        ...selectedIdeas.map(({ ideaId }, position) => ({
          type: "refined-idea" as const,
          ideaId,
          title: `Improved ${generatedIdeas[position].title}`,
          description: `Improved ${generatedIdeas[position].description}`,
        })),
        ...selectedIdeas.map(({ ideaId }, position) => ({
          type: "idea-deep-search-started" as const,
          ideaId,
          deepSearchJobId: `idea-search-${position + 2}`,
          title: `Improved ${generatedIdeas[position].title}`,
          slug: `idea-search-${position + 2}`,
          researchRequest: expectedRefinedIdeaResearchRequest(position),
        })),
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

  it("fails the whole job when one selected idea cannot be refined", async () => {
    const { input, events } = createInput()
    setupGenerations({ refinementFailureAt: 2 })
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        return Promise.resolve({
          deepSearchJobId: `initial-search-${position}`,
          title: searchInput.title ?? "Initial search",
          slug: `initial-search-${position}`,
          completion: Promise.resolve(`Research ${position}`),
        })
      },
    )

    await runIdeaJob(input)

    expect(mocks.startDeepSearch).toHaveBeenCalledTimes(2)
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Refinement failed before streaming",
      stage: "refinement",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      stage: "ideas",
      error: "Refinement failed before streaming",
    })
    expect(
      db
        .select()
        .from(ideas)
        .orderBy(ideas.position)
        .all()
        .filter(({ deepSearchJobId }) => deepSearchJobId !== null),
    ).toEqual([])
    expect(reconstructIdeaJobEvents(ideaJobId)).toContainEqual({
      type: "error",
      message: "Refinement failed before streaming",
      stage: "refinement",
    })
  })

  it("fails the whole job when one selected idea research fails", async () => {
    const { input, events } = createInput()
    setupGenerations()
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        const id = `search-${position}`
        if (position !== 4) {
          return Promise.resolve(persistCompletedSearch(id, searchInput))
        }
        const title = searchInput.title ?? "Failed idea research"
        db.insert(deepSearchJobs)
          .values({
            deepSearchJobId: id,
            userId: "test-user-id",
            ideaJobId: searchInput.ideaJobId,
            ideaJobPosition: searchInput.ideaJobPosition,
            title,
            slug: id,
            researchRequest: searchInput.researchRequest,
            maxSearches: searchInput.maxSearches,
            maxResultsPerSearch: searchInput.maxResultsPerSearch,
            status: "failed",
            error: "Selected idea research failed",
            completedAt: new Date(),
          })
          .run()
        return Promise.resolve({
          deepSearchJobId: id,
          title,
          slug: id,
          completion: Promise.reject(
            new Error("Selected idea research failed"),
          ),
        })
      },
    )

    await runIdeaJob(input)

    expect(mocks.startDeepSearch).toHaveBeenCalledTimes(8)
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Selected idea research failed",
      stage: "idea-research",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      stage: "ideas",
      error: "Selected idea research failed",
    })
    expect(reconstructIdeaJobEvents(ideaJobId)).toContainEqual({
      type: "error",
      message: "Selected idea research failed",
      stage: "idea-research",
    })
  })
})
