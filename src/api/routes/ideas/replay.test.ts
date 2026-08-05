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
    insertGeneration("planning-id", '["Research this"]')
    insertGeneration("summary-id", "Research briefing")
    insertGeneration(
      "ideas-id",
      '{"elements":[{"title":"Specific idea","description":"Concrete description"}]}',
    )
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        prompt: "Generate concepts",
        numberOfIdeas: 1,
        deepSearchCount: 1,
        researchPromptGenerationId: "planning-id",
        researchSummaryGenerationId: "summary-id",
        ideaGenerationId: "ideas-id",
        status: "completed",
        completedAt: new Date(),
      })
      .run()
    db.insert(ideas)
      .values({
        ideaId: "33333333-3333-4333-8333-333333333333",
        ideaJobId,
        position: 0,
        title: "Specific idea",
        description: "Concrete description",
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
        ideaJobId,
        researchRequest: "Research this",
        maxSearches: 3,
        maxResultsPerSearch: 3,
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

})
