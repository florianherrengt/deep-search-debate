import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../index.ts"
import {
  debateJobs,
  debateMatches,
  debateMessages,
  debateRounds,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchResults,
  deepSearchWebPages,
  ideaJobs,
  ideas,
  llmGenerations,
} from "./index.ts"

describe("aggregate deletion", () => {
  it("deletes every generation owned by a standalone deep search", () => {
    const deepSearchJobId = crypto.randomUUID()
    const llmGenerationId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        researchRequest: "Research a standalone question",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId,
        userId: "test-user-id",
        deepSearchJobId,
      })
      .run()
    db.update(deepSearchJobs)
      .set({ finalAnswerGenerationId: llmGenerationId })
      .run()

    db.delete(deepSearchJobs).run()

    expect(db.select().from(deepSearchJobs).all()).toEqual([])
    expect(db.select().from(llmGenerations).all()).toEqual([])
  })

  it("deletes every record and generation created for a debate", () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const deepSearchJobId = crypto.randomUUID()
    const refinedIdeaSearchJobId = crypto.randomUUID()
    const ideaGenerationId = crypto.randomUUID()
    const finalAnswerGenerationId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const debateGenerationId = crypto.randomUUID()
    const critiqueGenerationIds = [crypto.randomUUID(), crypto.randomUUID()]
    const refinementGenerationId = crypto.randomUUID()

    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 42,
        stage: "swiss",
      })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        prompt: "Generate and debate products",
        numberOfIdeas: 2,
        deepSearchCount: 1,
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        ideaJobId,
        ideaJobPosition: 0,
        userId: "test-user-id",
        slug: `initial-${deepSearchJobId}`,
        researchRequest: "Research the product market",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId: refinedIdeaSearchJobId,
        ideaJobId,
        ideaJobPosition: 1,
        userId: "test-user-id",
        slug: `refined-${refinedIdeaSearchJobId}`,
        researchRequest: "Research the refined product idea",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values([
        {
          llmGenerationId: ideaGenerationId,
          userId: "test-user-id",
          ideaJobId,
        },
        {
          llmGenerationId: finalAnswerGenerationId,
          userId: "test-user-id",
          deepSearchJobId,
        },
        {
          llmGenerationId: queryGenerationId,
          userId: "test-user-id",
          deepSearchJobId,
        },
        {
          llmGenerationId: debateGenerationId,
          userId: "test-user-id",
          debateJobId,
        },
        ...critiqueGenerationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          ideaJobId,
        })),
        {
          llmGenerationId: refinementGenerationId,
          userId: "test-user-id",
          ideaJobId,
        },
      ])
      .run()
    db.update(ideaJobs)
      .set({ researchPromptGenerationId: ideaGenerationId })
      .run()
    db.update(deepSearchJobs)
      .set({ finalAnswerGenerationId })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    const ideaRows = [
      {
        ideaId: crypto.randomUUID(),
        ideaJobId,
        position: 0,
        title: "Idea 1",
        description: "Description 1",
        critiqueGenerationId: critiqueGenerationIds[0],
        selected: true,
        refinementGenerationId,
        refinedTitle: "Improved idea 1",
        refinedDescription: "Improved description 1",
      },
      {
        ideaId: crypto.randomUUID(),
        ideaJobId,
        position: 1,
        title: "Idea 2",
        description: "Description 2",
        critiqueGenerationId: critiqueGenerationIds[1],
        selected: false,
      },
    ]
    db.insert(ideas).values(ideaRows).run()

    const debateRoundId = crypto.randomUUID()
    const debateMatchId = crypto.randomUUID()
    db.insert(debateRounds)
      .values({
        debateRoundId,
        debateJobId,
        stage: "swiss",
        stageRoundNumber: 1,
      })
      .run()
    db.insert(debateMatches)
      .values({
        debateMatchId,
        debateRoundId,
        position: 0,
        firstIdeaId: ideaRows[0].ideaId,
        secondIdeaId: ideaRows[1].ideaId,
      })
      .run()
    db.insert(debateMessages)
      .values({
        debateMessageId: crypto.randomUUID(),
        debateMatchId,
        position: 0,
        speakerSlot: 0,
        llmGenerationId: debateGenerationId,
      })
      .run()

    const deepSearchRoundId = crypto.randomUUID()
    const deepSearchQueryId = crypto.randomUUID()
    const deepSearchWebPageId = crypto.randomUUID()
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId,
        deepSearchJobId,
        llmGenerationId: queryGenerationId,
      })
      .run()
    db.insert(deepSearchQueries)
      .values({
        deepSearchQueryId,
        deepSearchRoundId,
        position: 0,
        query: "product market",
      })
      .run()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId,
        url: "https://example.com/research",
      })
      .run()
    db.insert(deepSearchResults)
      .values({
        deepSearchResultId: crypto.randomUUID(),
        deepSearchQueryId,
        position: 0,
        title: "Research result",
        shortText: "Useful evidence",
        url: "https://example.com/research",
        deepSearchWebPageId,
      })
      .run()

    expect(() =>
      db
        .delete(deepSearchWebPages)
        .where(
          eq(deepSearchWebPages.deepSearchWebPageId, deepSearchWebPageId),
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    db.delete(debateJobs).run()

    expect(db.select().from(debateJobs).all()).toEqual([])
    expect(db.select().from(ideaJobs).all()).toEqual([])
    expect(db.select().from(deepSearchJobs).all()).toEqual([])
    expect(db.select().from(ideas).all()).toEqual([])
    expect(db.select().from(debateRounds).all()).toEqual([])
    expect(db.select().from(debateMatches).all()).toEqual([])
    expect(db.select().from(debateMessages).all()).toEqual([])
    expect(db.select().from(deepSearchRounds).all()).toEqual([])
    expect(db.select().from(deepSearchQueries).all()).toEqual([])
    expect(db.select().from(deepSearchWebPages).all()).toEqual([])
    expect(db.select().from(deepSearchResults).all()).toEqual([])
    expect(db.select().from(llmGenerations).all()).toEqual([])
  })
})
