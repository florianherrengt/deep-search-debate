import { beforeEach, describe, expect, it } from "vitest"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"

const ideaJobId = "11111111-1111-4111-8111-111111111111"

function insertGeneration(id: string, text: string): void {
  db.insert(llmGenerations)
    .values({
      userId: "test-user-id",
      ideaJobId,
      llmGenerationId: id,
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
    db.insert(ideas)
      .values({
        ideaId: "33333333-3333-4333-8333-333333333333",
        ideaJobId,
        position: 0,
        title: "Specific idea",
        description: "Concrete description",
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
        researchRequest: "Research this",
      },
      { type: "research-summary-stream", streamId: "summary-id" },
      { type: "idea-generation-stream", streamId: "ideas-id" },
      {
        type: "idea",
        title: "Specific idea",
        description: "Concrete description",
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
        researchRequest: "First prompt",
      },
      {
        type: "deep-search-started",
        deepSearchJobId: "ffffffff-ffff-4fff-bfff-ffffffffffff",
        researchRequest: "Second prompt",
      },
    ])
  })
})
