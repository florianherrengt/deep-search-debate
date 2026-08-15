import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import z from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
  generateObjectStream: vi.fn(),
  generateTextStream: vi.fn(),
  requireParentQualityAcceptance: vi.fn(),
  startDeepSearch: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
  generateObjectStream: mocks.generateObjectStream,
  generateTextStream: mocks.generateTextStream,
}))

import { db } from "../../db/index.ts"
import { config } from "../../config.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { PromptName } from "../../llms/prompts.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import { normalizeIdeaSelection, runIdeaJob } from "./run.ts"
import type { Idea, IdeaEvaluation, IdeaJobEvent } from "./schemas.ts"

type SelectionOutput = { selectedIdeaIds: string[] }
type SelectionMockInput = {
  prompt: string
  schema: z.ZodType<SelectionOutput>
  onRegistered?: RegistrationHook
  onCompleted?: (
    result: { id: string; output: SelectionOutput },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

type EvaluationMockInput = {
  prompt: string
  schema: z.ZodType<IdeaEvaluation>
  onRegistered?: RegistrationHook
  onCompleted?: (
    result: { id: string; output: IdeaEvaluation },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

type RefinementMockInput = {
  prompt: string
  schema: z.ZodType<Idea>
  onRegistered?: RegistrationHook
  onCompleted?: (
    result: { id: string; output: Idea },
    transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => void
}

type TestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type RegistrationHook = (id: string, transaction: TestTransaction) => void
type GenerationMockInput = { onRegistered?: RegistrationHook }

function registerGeneration(input: GenerationMockInput, id: string): void {
  db.transaction((transaction) => input.onRegistered?.(id, transaction))
}

type StartSearchInput = {
  title?: string
  researchRequest: string
  maxSearches: number
  maxResultsPerSearch: number
  ideaJobId?: string
  ideaJobPosition?: number
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
const evaluationGenerationIds = generatedIdeas.map(
  (_, position) => `evaluation-${position + 1}-id`,
)
const generatedEvaluations: IdeaEvaluation[] = generatedIdeas.map(
  (_, position) => ({
    pros: [
      `Research-backed strength ${position + 1}`,
      `Practical advantage ${position + 1}`,
    ],
    cons: [
      `Unsupported assumption ${position + 1}`,
      `Implementation risk ${position + 1}`,
    ],
    critique: `Critique ${position + 1}`,
  }),
)
const refinementGenerationIds = generatedIdeas
  .slice(0, 6)
  .map((_, position) => `refinement-${position + 1}-id`)

function expectedRefinedIdeaResearchRequest(position: number): string {
  return [
    "Research this proposed idea against the user's request. Investigate evidence, comparable approaches, feasibility, risks, and implementation.",
    "\n<user_request>\n",
    JSON.stringify("Generate useful concepts"),
    "\n</user_request>\n<refined_idea>{\"title\":",
    JSON.stringify(`Improved ${generatedIdeas[position].title}`),
    ",\"description\":",
    JSON.stringify(`Improved ${generatedIdeas[position].description}`),
    "}</refined_idea>",
  ].join("")
}

function ideaPositionFromPrompt(
  prompt: string,
  element: "improved_idea" | "original_idea",
): number {
  const position = generatedIdeas.findIndex((idea) => {
    const value =
      element === "improved_idea"
        ? {
            title: `Improved ${idea.title}`,
            description: `Improved ${idea.description}`,
          }
        : idea
    return prompt.includes(
      `<${element}>\n${JSON.stringify(value)}\n</${element}>`,
    )
  })
  if (position < 0) throw new Error(`Prompt did not contain a known ${element}`)
  return position
}

function insertGeneration(
  id: string,
  text: string,
  promptName?: string,
): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      ideaJobId,
      llmGenerationId: id,
      promptName,
      status: "completed",
      text,
      reasoning: "Test reasoning",
      completedAt: new Date(),
    })
    .run()
}

function completedGeneration(text: string) {
  return Promise.resolve({
    status: "completed" as const,
    text,
    reasoning: "Test reasoning",
  })
}

function setupGenerations(options?: {
  evaluationFailureAt?: number
  refinementFailureAt?: number
  selectionCount?: number
}): void {
  insertGeneration("planning-id", JSON.stringify(researchPrompts))
  insertGeneration("summary-id", "Combined research briefing")
  insertGeneration("ideas-id", JSON.stringify(generatedIdeas))
  for (const [position, id] of evaluationGenerationIds.entries()) {
    insertGeneration(
      id,
      JSON.stringify(generatedEvaluations[position]),
      PromptName.EvaluateIdea,
    )
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
    .mockImplementationOnce((input: GenerationMockInput) => {
      registerGeneration(input, "planning-id")
      return Promise.resolve({
        id: "planning-id",
        output: Promise.resolve(researchPrompts),
        completion: completedGeneration(JSON.stringify(researchPrompts)),
      })
    })
    .mockImplementationOnce((input: GenerationMockInput) => {
      registerGeneration(input, "ideas-id")
      return Promise.resolve({
        id: "ideas-id",
        output: Promise.resolve(generatedIdeas),
        completion: completedGeneration(JSON.stringify(generatedIdeas)),
      })
    })
  mocks.generateTextStream
    .mockImplementationOnce((input: GenerationMockInput) => {
      registerGeneration(input, "summary-id")
      return Promise.resolve({
        id: "summary-id",
        completion: completedGeneration("Combined research briefing"),
      })
    })
  mocks.generateObjectStream.mockImplementation(
    (
      rawInput:
        | EvaluationMockInput
        | SelectionMockInput
        | RefinementMockInput,
    ) => {
      if (rawInput.prompt.includes("<improved_idea>")) {
        const { onCompleted, onRegistered, schema } =
          rawInput as EvaluationMockInput
        const position = ideaPositionFromPrompt(
          rawInput.prompt,
          "improved_idea",
        )
        if (position === options?.evaluationFailureAt) {
          return Promise.reject(
            new Error("Evaluation failed before streaming"),
          )
        }
        const id = evaluationGenerationIds[position]
        registerGeneration({ onRegistered }, id)
        const output = schema.parse(generatedEvaluations[position])
        db.transaction((transaction) => {
          onCompleted?.({ id, output }, transaction)
        })
        return Promise.resolve({
          id,
          output: Promise.resolve(output),
          completion: completedGeneration(JSON.stringify(output)),
        })
      }

      if (!rawInput.prompt.includes("<original_idea>")) {
        const { onCompleted, onRegistered, schema } = rawInput as SelectionMockInput
        registerGeneration({ onRegistered }, "selection-id")
        const selectedIdeaIds = db
          .select({ ideaId: ideas.ideaId })
          .from(ideas)
          .orderBy(ideas.position)
          .all()
          .slice(0, options?.selectionCount ?? 6)
          .map(({ ideaId }) => ideaId)
        const output = schema.parse({ selectedIdeaIds })
        db.transaction((transaction) => {
          onCompleted?.({ id: "selection-id", output }, transaction)
        })
        return Promise.resolve({
          id: "selection-id",
          output: Promise.resolve(output),
          completion: completedGeneration(JSON.stringify(output)),
        })
      }

      const { onCompleted, onRegistered, schema } = rawInput as RefinementMockInput
      const position = ideaPositionFromPrompt(rawInput.prompt, "original_idea")
      if (position === options?.refinementFailureAt) {
        return Promise.reject(
          new Error("Refinement failed before streaming"),
        )
      }
      const id = refinementGenerationIds[position]
      registerGeneration({ onRegistered }, id)
      const output = schema.parse({
        title: `Improved ${generatedIdeas[position].title}`,
        description: `Improved ${generatedIdeas[position].description}`,
      })
      const outputPromise = new Promise<Idea>((resolve) => {
        setTimeout(() => {
          db.transaction((transaction) => {
            onCompleted?.({ id, output }, transaction)
          })
          resolve(output)
        }, 0)
      })
      return Promise.resolve({
        id,
        output: outputPromise,
        completion: outputPromise.then((value) => ({
          status: "completed" as const,
          text: JSON.stringify(value),
          reasoning: "Test reasoning",
        })),
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

function createInput() {
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
    stop: vi.fn(),
    requireParentQualityAcceptance:
      mocks.requireParentQualityAcceptance,
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
      maxRounds: 3,
      job,
      deepSearchManager: manager,
    },
    events: collectEvents(job.subscribe()),
  }
}

describe("normalizeIdeaSelection", () => {
  it("caps an oversized valid proposal at twelve ideas", () => {
    const ideaIds = Array.from({ length: 14 }, () => randomUUID())

    expect(
      normalizeIdeaSelection(
        { selectedIdeaIds: ideaIds },
        ideaIds.map((ideaId) => ({ ideaId })),
      ),
    ).toEqual({ selectedIdeaIds: ideaIds.slice(0, 12) })
  })

  it("fills a duplicate or unknown proposal to the minimum selection", () => {
    const ideaIds = Array.from({ length: 8 }, () => randomUUID())

    expect(
      normalizeIdeaSelection(
        {
          selectedIdeaIds: [
            ideaIds[0],
            ideaIds[0],
            randomUUID(),
          ],
        },
        ideaIds.map((ideaId) => ({ ideaId })),
      ),
    ).toEqual({ selectedIdeaIds: ideaIds.slice(0, 6) })
  })

  it("makes an odd proposal even without mutating it", () => {
    const ideaIds = Array.from({ length: 8 }, () => randomUUID())
    const proposal = { selectedIdeaIds: ideaIds.slice(0, 7) }

    expect(
      normalizeIdeaSelection(
        proposal,
        ideaIds.map((ideaId) => ({ ideaId })),
      ),
    ).toEqual({ selectedIdeaIds: ideaIds })
    expect(proposal).toEqual({ selectedIdeaIds: ideaIds.slice(0, 7) })
  })
})

describe("runIdeaJob", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.delete(ideaJobs).run()
    db.delete(llmGenerations).run()
  })

  it("waits for durable generation completion after structured output fails", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", "invalid structured output")
    const terminal = Promise.withResolvers<{
      status: "completed"
      text: string
      reasoning: string
    }>()
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.reject(new Error("Invalid structured output")),
      completion: terminal.promise,
    })

    const running = runIdeaJob(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "running",
      stage: "planning",
    })

    terminal.resolve({
      status: "completed",
      text: "invalid structured output",
      reasoning: "Test reasoning",
    })
    await running

    const { element } = z
      .object({
        element: z.custom<z.ZodType<unknown>>(
          (value) => value instanceof z.ZodType,
        ),
      })
      .parse(mocks.generateArrayStream.mock.calls[0]?.[0] as unknown)
    expect(
      element.safeParse({
        title: "A".repeat(86),
        prompt: "A bounded research request",
      }).success,
    ).toBe(true)

    await expect(events).resolves.toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "error",
        message: "Invalid structured output",
        stage: "planning",
      },
      { type: "done" },
    ])
  })

  it("selects, improves, researches, and then evaluates the admitted ideas", async () => {
    const { input, events } = createInput()
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
    expect(mocks.requireParentQualityAcceptance).toHaveBeenCalledTimes(8)
    expect(mocks.startDeepSearch).toHaveBeenNthCalledWith(
      1,
      "test-user-id",
      {
        title: researchPrompts[0].title,
        researchRequest: researchPrompts[0].prompt,
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        ideaJobId: input.ideaJobId,
        ideaJobPosition: 0,
      },
    )
    expect(mocks.generateArrayStream).toHaveBeenCalledTimes(2)
    for (const [generationInput] of mocks.generateArrayStream.mock.calls) {
      expect(generationInput).not.toHaveProperty("maxRetries")
    }
    expect(mocks.generateTextStream).toHaveBeenCalledOnce()
    for (const [generationInput] of mocks.generateTextStream.mock.calls) {
      expect(generationInput).not.toHaveProperty("maxRetries")
    }
    const summaryInput = z
      .object({
        prompt: z.string(),
        reasoning: z.literal("disabled"),
      })
      .parse(mocks.generateTextStream.mock.calls[0]?.[0] as unknown)
    const ideaInput = z.object({ prompt: z.string() }).parse(
      mocks.generateArrayStream.mock.calls[1]?.[0] as unknown,
    )
    const selectionInput = z.object({ prompt: z.string() }).parse(
      mocks.generateObjectStream.mock.calls[0]?.[0] as unknown,
    )
    expect(selectionInput.prompt).toContain("<research_briefing>")
    for (const idea of generatedIdeas) {
      expect(selectionInput.prompt).toContain(idea.title)
    }
    expect(selectionInput.prompt).not.toContain("Critique 1")
    const refinementInputs = mocks.generateObjectStream.mock.calls
      .slice(1, 7)
      .map(([value]) =>
        z.object({ prompt: z.string() }).parse(value as unknown),
      )
    expect(refinementInputs).toHaveLength(6)
    for (const [position, refinementInput] of refinementInputs.entries()) {
      expect(refinementInput.prompt).toContain("<research_briefing>")
      expect(refinementInput.prompt).not.toContain("<evaluation>")
      expect(refinementInput.prompt).toContain(
        `<original_idea>\n${JSON.stringify(generatedIdeas[position])}\n</original_idea>`,
      )
    }
    const evaluationInputs = mocks.generateObjectStream.mock.calls
      .slice(7)
      .map(([value]) =>
        z
          .object({
            prompt: z.string(),
            reasoning: z.literal("disabled"),
            maxOutputTokens: z.literal(1_024),
          })
          .parse(value as unknown),
      )
    expect(summaryInput.prompt).toContain("<research_text index=")
    expect(ideaInput.prompt).toContain("<research_briefing>")
    expect(evaluationInputs).toHaveLength(6)
    for (const [position, evaluationInput] of evaluationInputs.entries()) {
      expect(evaluationInput.prompt).toContain("<research_briefing>")
      expect(evaluationInput.prompt).toContain(
        `<improved_idea>\n${JSON.stringify({
          title: `Improved ${generatedIdeas[position].title}`,
          description: `Improved ${generatedIdeas[position].description}`,
        })}\n</improved_idea>`,
      )
      expect(evaluationInput.prompt).toContain("<supporting_research>")
      expect(evaluationInput.prompt).toContain(
        `Research answer for Improved ${generatedIdeas[position].title}`,
      )
    }
    expect(mocks.generateObjectStream).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: "disabled",
      }),
    )
    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(13)
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
          researchRequest: expectedRefinedIdeaResearchRequest(position),
        }),
      )
      expect(idea).toMatchObject({
        refinementGenerationId: refinementGenerationIds[position],
        refinedTitle: `Improved ${generatedIdeas[position].title}`,
        refinedDescription: `Improved ${generatedIdeas[position].description}`,
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
      ...selectedIdeas.map(({ ideaId }, position) => ({
        type: "idea-evaluated" as const,
        ideaId,
        ...generatedEvaluations[position],
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
        evaluationGenerationId:
          position < 6 ? evaluationGenerationIds[position] : null,
        selected: position < 6,
        refinementGenerationId:
          position < 6 ? refinementGenerationIds[position] : null,
        refinedTitle: position < 6 ? `Improved ${idea.title}` : null,
        refinedDescription:
          position < 6 ? `Improved ${idea.description}` : null,
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

  it("fills an undersized model selection to the tournament minimum", async () => {
    const { input, events } = createInput()
    setupGenerations({ selectionCount: 5 })
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        return Promise.resolve(
          persistCompletedSearch(`normalized-search-${position}`, searchInput),
        )
      },
    )

    await runIdeaJob(input)

    const persistedIdeas = db.select().from(ideas).orderBy(ideas.position).all()
    expect(persistedIdeas.filter(({ selected }) => selected)).toHaveLength(6)
    await expect(events).resolves.toContainEqual({
      type: "selected-ideas",
      selectedIdeaIds: persistedIdeas
        .slice(0, 6)
        .map(({ ideaId }) => ideaId),
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "completed",
      error: null,
    })
  })

  it("fits refined-idea child requests under the external request ceiling", async () => {
    const { input, events } = createInput()
    input.prompt = "x".repeat(config.deepSearch.maxRequestChars)
    db.update(ideaJobs)
      .set({ prompt: input.prompt })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    setupGenerations()
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        return Promise.resolve(
          persistCompletedSearch(`bounded-search-${position}`, searchInput),
        )
      },
    )

    await runIdeaJob(input)
    await events

    const refinedRequests = mocks.startDeepSearch.mock.calls
      .map(([, searchInput]) => searchInput as StartSearchInput)
      .filter(
        ({ ideaJobPosition }) =>
          ideaJobPosition !== undefined &&
          ideaJobPosition >= input.deepSearchCount,
      )
      .map(({ researchRequest }) => researchRequest)
    expect(refinedRequests).toHaveLength(6)
    for (const request of refinedRequests) {
      expect(request.length).toBeLessThanOrEqual(
        config.deepSearch.maxRequestChars,
      )
      expect(request).toContain("[... omitted ...]")
    }
  })

  it("fails the whole pipeline without summarising when any research fails", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      completion: completedGeneration(JSON.stringify(researchPrompts)),
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

  it("fails the parent quality gate after a child durably completes", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      completion: completedGeneration(JSON.stringify(researchPrompts)),
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
    mocks.requireParentQualityAcceptance.mockImplementation((jobId: string) => {
      if (jobId === "search-two") throw new Error("Summary failed")
    })

    await runIdeaJob(input)

    expect(mocks.generateTextStream).not.toHaveBeenCalled()
    expect(mocks.requireParentQualityAcceptance).toHaveBeenCalledTimes(2)
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Summary failed",
      stage: "research",
    })
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Summary failed",
      stage: "research",
    })
  })

  it("waits for started sibling research when another child cannot start", async () => {
    const { input, events } = createInput()
    insertGeneration("planning-id", JSON.stringify(researchPrompts))
    mocks.generateArrayStream.mockResolvedValue({
      id: "planning-id",
      output: Promise.resolve(researchPrompts),
      completion: completedGeneration(JSON.stringify(researchPrompts)),
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
      completion: completedGeneration(JSON.stringify(researchPrompts)),
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

  it("retains generated ideas when one evaluation cannot start", async () => {
    const { input, events } = createInput()
    setupGenerations({ evaluationFailureAt: 0 })
    mocks.startDeepSearch.mockImplementation(
      (_userId: string, searchInput: StartSearchInput) => {
        const position = searchInput.ideaJobPosition ?? 0
        return Promise.resolve(
          persistCompletedSearch(`evaluation-search-${position}`, searchInput),
        )
      },
    )

    await runIdeaJob(input)

    expect(mocks.generateTextStream).toHaveBeenCalledOnce()
    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(13)
    await expect(events).resolves.toContainEqual({
      type: "error",
      message: "Evaluation failed before streaming",
      stage: "evaluation",
    })
    const persistedIdeas = db
      .select()
      .from(ideas)
      .orderBy(ideas.position)
      .all()
    expect(db.select().from(ideaJobs).get()).toMatchObject({
      status: "failed",
      error: "Evaluation failed before streaming",
      stage: "ideas",
    })
    expect(persistedIdeas).toMatchObject(
      generatedIdeas.map((idea, position) => ({
        ...idea,
        evaluationGenerationId:
          position === 0 || position >= 6
            ? null
            : evaluationGenerationIds[position],
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
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
        .all()
        .filter(
          ({ ideaJobPosition }) =>
            ideaJobPosition !== null && ideaJobPosition >= input.deepSearchCount,
        ),
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
