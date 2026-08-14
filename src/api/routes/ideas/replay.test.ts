import { beforeEach, describe, expect, it } from "vitest"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { PromptName } from "../../llms/prompts.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"

const ideaJobId = "11111111-1111-4111-8111-111111111111"

function insertGeneration(id: string, text: string, promptName?: string): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      ideaJobId,
      llmGenerationId: id,
      promptName,
      status: "completed",
      text,
      reasoning: `Reasoning for ${id}`,
      completedAt: new Date(),
    })
    .run()
}

describe("reconstructIdeaJobEvents", () => {
  beforeEach(() => {
    db.delete(ideaJobs).run()
    db.delete(llmGenerations).run()
  })

  it("replays a structured idea evaluation from its generation", () => {
    const ideaId = "33333333-3333-4333-8333-333333333333"
    const evaluation = {
      pros: ["Clear user value", "Fits the existing workflow"],
      cons: ["Depends on clean data", "Requires behavior change"],
      critique: "Promising, but the first release should expose uncertainty.",
    }
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      })
      .run()
    insertGeneration(
      "evaluation-id",
      JSON.stringify(evaluation),
      PromptName.EvaluateIdea,
    )
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Specific idea",
        description: "Concrete description",
        evaluationGenerationId: "evaluation-id",
      })
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        status: "failed",
        error: "Selection failed",
        completedAt: new Date(),
      })
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual([
      {
        type: "idea",
        ideaId,
        title: "Specific idea",
        description: "Concrete description",
      },
      { type: "idea-evaluated", ideaId, ...evaluation },
      { type: "error", message: "Selection failed", stage: "selection" },
      { type: "done" },
    ])
  })

  it("keeps an invalid structured evaluation in the evaluation failure stage", () => {
    const ideaId = "33333333-3333-4333-8333-333333333333"
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      })
      .run()
    insertGeneration(
      "invalid-evaluation-id",
      '{"pros":["Only one"],"cons":[],"critique":"Incomplete"}',
      PromptName.EvaluateIdea,
    )
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Specific idea",
        description: "Concrete description",
        evaluationGenerationId: "invalid-evaluation-id",
      })
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        status: "failed",
        error: "Structured output was invalid",
        completedAt: new Date(),
      })
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual([
      {
        type: "idea",
        ideaId,
        title: "Specific idea",
        description: "Concrete description",
      },
      {
        type: "error",
        message: "Structured output was invalid",
        stage: "evaluation",
      },
      { type: "done" },
    ])
  })

  it("replays every persisted stage and its normalized ideas", () => {
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      })
      .run()
    insertGeneration("planning-id", '["Research this"]')
    insertGeneration("summary-id", "Research briefing")
    insertGeneration(
      "ideas-id",
      '{"elements":[{"title":"Specific idea","description":"Concrete description"}]}',
    )
    const evaluation = {
      pros: ["Clear value", "Practical workflow"],
      cons: ["Data dependency", "Adoption risk"],
      critique: "Promising with a focused pilot.",
    }
    insertGeneration(
      "evaluation-id",
      JSON.stringify(evaluation),
      PromptName.EvaluateIdea,
    )
    db.insert(ideas)
      .values({
        ideaId: "33333333-3333-4333-8333-333333333333",
        ideaJobId,
        position: 0,
        title: "Specific idea",
        description: "Concrete description",
        evaluationGenerationId: "evaluation-id",
      })
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        researchPromptGenerationId: "planning-id",
        researchSummaryGenerationId: "summary-id",
        ideaGenerationId: "ideas-id",
        status: "completed",
        completedAt: new Date(),
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        userId: "test-user-id",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
        slug: "research-this",
        ideaJobId,
        ideaJobPosition: 0,
        researchRequest: "Research this",
        maxSearches: 3,
        maxResultsPerSearch: 3,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        userId: "test-user-id",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
        llmGenerationId: "deep-search-final-id",
        status: "completed",
        text: "Research result",
        reasoning: "Research reasoning",
        completedAt: new Date(),
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: "deep-search-final-id",
        status: "completed",
        completedAt: new Date(),
      })
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual([
      { type: "research-prompt-stream", streamId: "planning-id" },
      {
        type: "deep-search-started",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
        title: "Untitled",
        slug: "research-this",
        researchRequest: "Research this",
      },
      { type: "research-summary-stream", streamId: "summary-id" },
      { type: "idea-generation-stream", streamId: "ideas-id" },
      {
        type: "idea",
        ideaId: "33333333-3333-4333-8333-333333333333",
        title: "Specific idea",
        description: "Concrete description",
      },
      {
        type: "idea-evaluated",
        ideaId: "33333333-3333-4333-8333-333333333333",
        ...evaluation,
      },
      { type: "done" },
    ])
  })

  it("replays an idea whose evaluation never started", () => {
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      })
      .run()
    db.insert(ideas)
      .values({
        ideaId: "33333333-3333-4333-8333-333333333333",
        ideaJobId,
        position: 0,
        title: "Visible before evaluation",
        description: "This idea already exists",
      })
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        status: "failed",
        error: "Evaluation failed before streaming",
        completedAt: new Date(),
      })
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual([
      {
        type: "idea",
        ideaId: "33333333-3333-4333-8333-333333333333",
        title: "Visible before evaluation",
        description: "This idea already exists",
      },
      {
        type: "error",
        message: "Evaluation failed before streaming",
        stage: "evaluation",
      },
      { type: "done" },
    ])
  })

  it("replays parallel child searches in planning order", () => {
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 2,
      })
      .run()
    const createdAt = new Date("2026-01-02T00:00:00.123Z")
    db.insert(deepSearchJobs)
      .values([
        {
          userId: "test-user-id",
          deepSearchJobId: "ffffffff-ffff-4fff-bfff-ffffffffffff",
          slug: "second-prompt",
          ideaJobId,
          ideaJobPosition: 1,
          researchRequest: "Second prompt",
          maxSearches: 3,
          maxResultsPerSearch: 3,
          createdAt,
        },
        {
          userId: "test-user-id",
          deepSearchJobId: "00000000-0000-4000-8000-000000000000",
          slug: "first-prompt",
          ideaJobId,
          ideaJobPosition: 0,
          researchRequest: "First prompt",
          maxSearches: 3,
          maxResultsPerSearch: 3,
          createdAt,
        },
      ])
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toEqual([
      {
        type: "deep-search-started",
        deepSearchJobId: "00000000-0000-4000-8000-000000000000",
        title: "Untitled",
        slug: "first-prompt",
        researchRequest: "First prompt",
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "ffffffff-ffff-4fff-bfff-ffffffffffff",
        title: "Untitled",
        slug: "second-prompt",
        researchRequest: "Second prompt",
      },
    ])
  })

  it("derives selected-idea research from the owned child position", () => {
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 2,
      })
      .run()
    insertGeneration("refinement-id", '{"title":"Refined","description":"Better"}')
    const ideaId = "33333333-3333-4333-8333-333333333333"
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Original",
        description: "Original description",
        selected: true,
        refinementGenerationId: "refinement-id",
        refinedTitle: "Refined",
        refinedDescription: "Better",
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        userId: "test-user-id",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
        title: "Refined",
        slug: "refined",
        ideaJobId,
        ideaJobPosition: 2,
        researchRequest: "Research the refined idea",
        maxSearches: 3,
        maxResultsPerSearch: 3,
      })
      .run()

    expect(reconstructIdeaJobEvents(ideaJobId)).toContainEqual({
      type: "idea-deep-search-started",
      ideaId,
      deepSearchJobId: "22222222-2222-4222-8222-222222222222",
      title: "Refined",
      slug: "refined",
      researchRequest: "Research the refined idea",
    })
  })
})
