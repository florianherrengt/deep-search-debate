import { and, eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../index.ts"
import {
  debateJobs,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchResults,
  deepSearchWebPages,
  ideaJobs,
  ideas,
  llmGenerations,
  user,
} from "./index.ts"

const userId = "test-user-id"

function insertIdeaJob(): string {
  const ideaJobId = crypto.randomUUID()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      userId,
      slug: `ideas-${ideaJobId}`,
      prompt: "Generate ideas",
      numberOfIdeas: 1,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    })
    .run()
  return ideaJobId
}

function insertDeepSearchJob(): string {
  const deepSearchJobId = crypto.randomUUID()
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      userId,
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research this",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      strictQuality: false,
    })
    .run()
  return deepSearchJobId
}

function insertDeepSearchQuery(deepSearchJobId: string): {
  deepSearchRoundId: string
  deepSearchQueryId: string
} {
  const llmGenerationId = crypto.randomUUID()
  db.insert(llmGenerations)
    .values({ llmGenerationId, userId, deepSearchJobId })
    .run()

  const deepSearchRoundId = crypto.randomUUID()
  db.insert(deepSearchRounds)
    .values({
      deepSearchRoundId,
      deepSearchJobId,
      llmGenerationId,
    })
    .run()

  const deepSearchQueryId = crypto.randomUUID()
  db.insert(deepSearchQueries)
    .values({
      deepSearchQueryId,
      deepSearchRoundId,
      position: 0,
      query: "research query",
    })
    .run()
  return { deepSearchRoundId, deepSearchQueryId }
}

describe("aggregate integrity constraints", () => {
  it("keeps public resource slugs globally unique", () => {
    const foreignUserId = crypto.randomUUID()
    db.insert(user)
      .values({
        id: foreignUserId,
        name: "Foreign User",
        email: `${foreignUserId}@example.com`,
        emailVerified: true,
      })
      .run()

    const ideaSlug = `shared-idea-${crypto.randomUUID()}`
    db.insert(ideaJobs)
      .values({
        ideaJobId: crypto.randomUUID(),
        userId,
        slug: ideaSlug,
        prompt: "First ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
        maxSearches: 1,
        maxResultsPerSearch: 1,
        maxRounds: 1,
      })
      .run()
    expect(() =>
      db
        .insert(ideaJobs)
        .values({
          ideaJobId: crypto.randomUUID(),
          userId: foreignUserId,
          slug: ideaSlug,
          prompt: "Second ideas",
          numberOfIdeas: 1,
          deepSearchCount: 1,
          maxSearches: 1,
          maxResultsPerSearch: 1,
          maxRounds: 1,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)

    const deepSearchSlug = `shared-search-${crypto.randomUUID()}`
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId: crypto.randomUUID(),
        userId,
        slug: deepSearchSlug,
        researchRequest: "First search",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        strictQuality: false,
      })
      .run()
    expect(() =>
      db
        .insert(deepSearchJobs)
        .values({
          deepSearchJobId: crypto.randomUUID(),
          userId: foreignUserId,
          slug: deepSearchSlug,
          researchRequest: "Second search",
          maxSearches: 1,
          maxResultsPerSearch: 1,
          strictQuality: false,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
  })

  it("rejects same-user generation links owned by another root job", () => {
    const firstIdeaJobId = insertIdeaJob()
    const secondIdeaJobId = insertIdeaJob()
    const ideaGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: ideaGenerationId,
        userId,
        ideaJobId: firstIdeaJobId,
      })
      .run()

    expect(() =>
      db
        .update(ideaJobs)
        .set({ researchPromptGenerationId: ideaGenerationId })
        .where(sql`${ideaJobs.ideaJobId} = ${secondIdeaJobId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    const firstDeepSearchJobId = insertDeepSearchJob()
    const secondDeepSearchJobId = insertDeepSearchJob()
    const deepSearchGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: deepSearchGenerationId,
        userId,
        deepSearchJobId: firstDeepSearchJobId,
      })
      .run()

    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ finalAnswerGenerationId: deepSearchGenerationId })
        .where(sql`${deepSearchJobs.deepSearchJobId} = ${secondDeepSearchJobId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ researchAnalysisGenerationId: deepSearchGenerationId })
        .where(sql`${deepSearchJobs.deepSearchJobId} = ${secondDeepSearchJobId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    db.update(deepSearchJobs)
      .set({ researchAnalysisGenerationId: deepSearchGenerationId })
      .where(sql`${deepSearchJobs.deepSearchJobId} = ${firstDeepSearchJobId}`)
      .run()
    expect(() =>
      db
        .delete(llmGenerations)
        .where(
          sql`${llmGenerations.llmGenerationId} = ${deepSearchGenerationId}`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  it("keeps generation ownership immutable after insertion", () => {
    const firstDeepSearchJobId = insertDeepSearchJob()
    const secondDeepSearchJobId = insertDeepSearchJob()
    const llmGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({ llmGenerationId, userId, deepSearchJobId: firstDeepSearchJobId })
      .run()
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId: crypto.randomUUID(),
        deepSearchJobId: firstDeepSearchJobId,
        llmGenerationId,
      })
      .run()

    expect(() =>
      db
        .update(llmGenerations)
        .set({ deepSearchJobId: null })
        .where(sql`${llmGenerations.llmGenerationId} = ${llmGenerationId}`)
        .run(),
    ).toThrow(/LLM generation ownership columns are immutable/)
    expect(() =>
      db
        .update(llmGenerations)
        .set({ deepSearchJobId: secondDeepSearchJobId })
        .where(sql`${llmGenerations.llmGenerationId} = ${llmGenerationId}`)
        .run(),
    ).toThrow(/LLM generation ownership columns are immutable/)
  })

  it("keeps search rounds ordered and review outcomes internally consistent", () => {
    const deepSearchJobId = insertDeepSearchJob()
    const generationIds = Array.from({ length: 4 }, () => crypto.randomUUID())
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId,
          deepSearchJobId,
        })),
      )
      .run()
    db.insert(deepSearchRounds)
      .values([
        {
          deepSearchRoundId: crypto.randomUUID(),
          deepSearchJobId,
          position: 0,
          llmGenerationId: generationIds[0],
        },
        {
          deepSearchRoundId: crypto.randomUUID(),
          deepSearchJobId,
          position: 1,
          llmGenerationId: generationIds[1],
        },
      ])
      .run()

    expect(() =>
      db
        .update(deepSearchRounds)
        .set({ llmGenerationId: generationIds[2] })
        .where(
          and(
            eq(deepSearchRounds.deepSearchJobId, deepSearchJobId),
            eq(deepSearchRounds.position, 0),
          ),
        )
        .run(),
    ).not.toThrow()
    expect(
      db
        .select({ llmGenerationId: deepSearchRounds.llmGenerationId })
        .from(deepSearchRounds)
        .where(
          and(
            eq(deepSearchRounds.deepSearchJobId, deepSearchJobId),
            eq(deepSearchRounds.position, 0),
          ),
        )
        .get(),
    ).toEqual({ llmGenerationId: generationIds[2] })
    expect(
      db
        .select({ llmGenerationId: llmGenerations.llmGenerationId })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, generationIds[0]))
        .get(),
    ).toEqual({ llmGenerationId: generationIds[0] })

    expect(() =>
      db
        .insert(deepSearchRounds)
        .values({
          deepSearchRoundId: crypto.randomUUID(),
          deepSearchJobId,
          position: 1,
          llmGenerationId: generationIds[2],
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)

    expect(() =>
      db
        .update(deepSearchRounds)
        .set({
          reviewGenerationId: generationIds[3],
          reviewDecision: "continue",
        })
        .where(
          and(
            eq(deepSearchRounds.deepSearchJobId, deepSearchJobId),
            eq(deepSearchRounds.position, 0),
          ),
        )
        .run(),
    ).toThrow(/deep_search_rounds_review_lifecycle_check/)

    expect(() =>
      db
        .insert(deepSearchJobs)
        .values({
          deepSearchJobId: crypto.randomUUID(),
          userId,
          researchRequest: "Invalid round limit",
          maxSearches: 1,
          maxResultsPerSearch: 1,
          maxRounds: 0,
          strictQuality: false,
        })
        .run(),
    ).toThrow(/deep_search_jobs_limits_check/)
  })

  it("freezes ideas after completion without blocking aggregate deletion", () => {
    const ideaJobId = insertIdeaJob()
    const ideaId = crypto.randomUUID()
    const generationIds = Array.from({ length: 4 }, () => crypto.randomUUID())
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId,
          ideaJobId,
        })),
      )
      .run()
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Original idea",
        description: "Original description",
        evaluationGenerationId: generationIds[3],
      })
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        researchPromptGenerationId: generationIds[0],
        researchSummaryGenerationId: generationIds[1],
        ideaGenerationId: generationIds[2],
        status: "completed",
        completedAt: new Date(),
      })
      .where(sql`${ideaJobs.ideaJobId} = ${ideaJobId}`)
      .run()

    expect(() =>
      db
        .update(ideas)
        .set({ title: "Rewritten idea" })
        .where(sql`${ideas.ideaId} = ${ideaId}`)
        .run(),
    ).toThrow(/idea rows are immutable/)
    expect(() =>
      db
        .insert(ideas)
        .values({
          ideaId: crypto.randomUUID(),
          ideaJobId,
          position: 1,
          title: "Late idea",
          description: "Added after completion",
          evaluationGenerationId: generationIds[3],
        })
        .run(),
    ).toThrow(/terminal idea collections are immutable/)
    expect(() =>
      db.delete(ideas).where(sql`${ideas.ideaId} = ${ideaId}`).run(),
    ).toThrow(/idea rows are immutable/)

    expect(() =>
      db
        .delete(ideaJobs)
        .where(sql`${ideaJobs.ideaJobId} = ${ideaJobId}`)
        .run(),
    ).not.toThrow()
    expect(
      db.select().from(ideas).where(sql`${ideas.ideaId} = ${ideaId}`).all(),
    ).toEqual([])
  })

  it("allows ideas before evaluation and resolves pipeline links only once", () => {
    const ideaJobId = insertIdeaJob()
    const evaluationGenerationId = crypto.randomUUID()
    const replacementEvaluationGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values([
        { llmGenerationId: evaluationGenerationId, userId, ideaJobId },
        {
          llmGenerationId: replacementEvaluationGenerationId,
          userId,
          ideaJobId,
        },
      ])
      .run()
    const firstIdeaId = crypto.randomUUID()
    const secondIdeaId = crypto.randomUUID()
    db.insert(ideas)
      .values([
        {
          ideaId: firstIdeaId,
          ideaJobId,
          position: 0,
          title: "First idea",
          description: "First description",
        },
        {
          ideaId: secondIdeaId,
          ideaJobId,
          position: 1,
          title: "Second idea",
          description: "Second description",
        },
      ])
      .run()
    expect(db.select().from(ideas).all()).toMatchObject([
      { evaluationGenerationId: null },
      { evaluationGenerationId: null },
    ])
    db.update(ideas)
      .set({ evaluationGenerationId })
      .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
      .run()

    expect(() =>
      db
        .update(ideas)
        .set({ evaluationGenerationId })
        .where(sql`${ideas.ideaId} = ${secondIdeaId}`)
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
    expect(() =>
      db
        .update(ideas)
        .set({ evaluationGenerationId: crypto.randomUUID() })
        .where(sql`${ideas.ideaId} = ${secondIdeaId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() =>
      db
        .update(ideas)
        .set({ evaluationGenerationId: null })
        .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
        .run(),
    ).toThrow(/one-time pipeline linkage/)

    db.update(ideas)
      .set({ evaluationGenerationId: replacementEvaluationGenerationId })
      .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
      .run()
    expect(
      db
        .select({ evaluationGenerationId: ideas.evaluationGenerationId })
        .from(ideas)
        .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
        .get(),
    ).toEqual({ evaluationGenerationId: replacementEvaluationGenerationId })
    expect(
      db
        .select({ llmGenerationId: llmGenerations.llmGenerationId })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, evaluationGenerationId))
        .get(),
    ).toEqual({ llmGenerationId: evaluationGenerationId })

    db.update(ideas)
      .set({ selected: true })
      .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
      .run()
    db.update(ideas)
      .set({ selected: false })
      .where(sql`${ideas.ideaId} = ${secondIdeaId}`)
      .run()
    expect(() =>
      db
        .update(ideas)
        .set({ selected: false })
        .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
        .run(),
    ).toThrow(/one-time pipeline linkage/)
  })

  it("links refinement and research only to the selected owning idea", () => {
    const ideaJobId = insertIdeaJob()
    const otherIdeaJobId = insertIdeaJob()
    const selectedIdeaId = crypto.randomUUID()
    const rejectedIdeaId = crypto.randomUUID()
    const otherGenerationId = crypto.randomUUID()
    const refinementGenerationIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]
    db.insert(llmGenerations)
      .values([
        ...refinementGenerationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId,
          ideaJobId,
        })),
        {
          llmGenerationId: otherGenerationId,
          userId,
          ideaJobId: otherIdeaJobId,
        },
      ])
      .run()
    db.insert(ideas)
      .values([
        {
          ideaId: selectedIdeaId,
          ideaJobId,
          position: 0,
          title: "Selected idea",
          description: "Selected description",
          selected: true,
        },
        {
          ideaId: rejectedIdeaId,
          ideaJobId,
          position: 1,
          title: "Rejected idea",
          description: "Rejected description",
          selected: false,
        },
      ])
      .run()

    expect(() =>
      db
        .update(ideas)
        .set({ refinementGenerationId: refinementGenerationIds[1] })
        .where(sql`${ideas.ideaId} = ${rejectedIdeaId}`)
        .run(),
    ).toThrow(/ideas_refinement_lifecycle_check/)

    expect(() =>
      db
        .update(ideas)
        .set({ refinementGenerationId: otherGenerationId })
        .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    db.update(ideas)
      .set({ refinementGenerationId: refinementGenerationIds[0] })
      .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
      .run()
    db.update(ideas)
      .set({ refinementGenerationId: refinementGenerationIds[1] })
      .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
      .run()
    expect(() =>
      db
        .update(ideas)
        .set({ refinedTitle: "Partial refinement" })
        .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
        .run(),
    ).toThrow(/one-time pipeline linkage/)
    db.update(ideas)
      .set({
        refinedTitle: "Improved selected idea",
        refinedDescription: "Improved selected description",
      })
      .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
      .run()

    expect(() =>
      db
        .update(ideas)
        .set({ refinedTitle: "Rewritten refinement" })
        .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
        .run(),
    ).toThrow(/one-time pipeline linkage/)
    expect(
      db
        .select()
        .from(ideas)
        .where(sql`${ideas.ideaId} = ${selectedIdeaId}`)
        .get(),
    ).toMatchObject({
      refinementGenerationId: refinementGenerationIds[1],
      refinedTitle: "Improved selected idea",
      refinedDescription: "Improved selected description",
    })
  })

  it("rejects whitespace-only durable input and search facts", () => {
    expect(() =>
      db
        .insert(ideaJobs)
        .values({
          ideaJobId: crypto.randomUUID(),
          userId,
          prompt: "   ",
          numberOfIdeas: 1,
          deepSearchCount: 1,
          maxSearches: 1,
          maxResultsPerSearch: 1,
          maxRounds: 1,
        })
        .run(),
    ).toThrow(/idea_jobs_prompt_content_check/)

    expect(() =>
      db
        .insert(deepSearchJobs)
        .values({
          deepSearchJobId: crypto.randomUUID(),
          userId,
          researchRequest: "   ",
          maxSearches: 1,
          maxResultsPerSearch: 1,
          strictQuality: false,
        })
        .run(),
    ).toThrow(/deep_search_jobs_research_request_content_check/)

    const deepSearchJobId = insertDeepSearchJob()
    const llmGenerationId = crypto.randomUUID()
    const deepSearchRoundId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({ llmGenerationId, userId, deepSearchJobId })
      .run()
    db.insert(deepSearchRounds)
      .values({
        deepSearchRoundId,
        deepSearchJobId,
        llmGenerationId,
      })
      .run()
    expect(() =>
      db
        .insert(deepSearchQueries)
        .values({
          deepSearchQueryId: crypto.randomUUID(),
          deepSearchRoundId,
          position: 0,
          query: "   ",
        })
        .run(),
    ).toThrow(/deep_search_queries_content_check/)
    expect(() =>
      db
        .insert(deepSearchWebPages)
        .values({
          deepSearchWebPageId: crypto.randomUUID(),
          deepSearchJobId,
          url: "   ",
        })
        .run(),
    ).toThrow(/deep_search_web_pages_url_content_check/)

    const { deepSearchQueryId } = insertDeepSearchQuery(insertDeepSearchJob())
    for (const values of [
      { title: "   ", shortText: "Evidence", url: "https://example.com" },
      { title: "Result", shortText: "   ", url: "https://example.com" },
      { title: "Result", shortText: "Evidence", url: "   " },
    ]) {
      expect(() =>
        db
          .insert(deepSearchResults)
          .values({
            deepSearchResultId: crypto.randomUUID(),
            deepSearchQueryId,
            position: 0,
            ...values,
          })
          .run(),
      ).toThrow(/deep_search_results_content_check/)
    }
  })

  it("requires complete root-job terminal state", () => {
    const ideaJobId = insertIdeaJob()
    const generationIds = Array.from({ length: 2 }, () => crypto.randomUUID())
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId,
          ideaJobId,
        })),
      )
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        researchPromptGenerationId: generationIds[0],
        researchSummaryGenerationId: generationIds[1],
      })
      .where(sql`${ideaJobs.ideaJobId} = ${ideaJobId}`)
      .run()

    expect(() =>
      db
        .update(ideaJobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(sql`${ideaJobs.ideaJobId} = ${ideaJobId}`)
        .run(),
    ).toThrow(/idea_jobs_terminal_fields_check/)

    const deepSearchJobId = insertDeepSearchJob()
    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(sql`${deepSearchJobs.deepSearchJobId} = ${deepSearchJobId}`)
        .run(),
    ).toThrow(/deep_search_jobs_terminal_fields_check/)
  })

  it("constrains mutable feedback to completed jobs", () => {
    const deepSearchJobId = insertDeepSearchJob()
    const ideaJobId = insertIdeaJob()
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId, randomSeed: 1 })
      .run()

    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ feedbackRating: true })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_feedback_rating_check/)
    expect(() =>
      db
        .update(ideaJobs)
        .set({ feedbackRating: false })
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .run(),
    ).toThrow(/idea_jobs_feedback_rating_check/)
    expect(() =>
      db
        .update(debateJobs)
        .set({ feedbackRating: true })
        .where(eq(debateJobs.debateJobId, debateJobId))
        .run(),
    ).toThrow(/debate_jobs_feedback_rating_check/)

    const deepSearchGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: deepSearchGenerationId,
        userId,
        deepSearchJobId,
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: deepSearchGenerationId,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    const ideaGenerationIds = Array.from(
      { length: 3 },
      () => crypto.randomUUID(),
    )
    db.insert(llmGenerations)
      .values(
        ideaGenerationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId,
          ideaJobId,
        })),
      )
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        researchPromptGenerationId: ideaGenerationIds[0],
        researchSummaryGenerationId: ideaGenerationIds[1],
        ideaGenerationId: ideaGenerationIds[2],
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()

    db.update(debateJobs)
      .set({
        stage: "final",
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ feedbackText: "Missing rating" })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_feedback_text_check/)
    expect(() =>
      db
        .update(ideaJobs)
        .set({ feedbackText: "Missing rating" })
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .run(),
    ).toThrow(/idea_jobs_feedback_text_check/)
    expect(() =>
      db
        .update(debateJobs)
        .set({ feedbackText: "Missing rating" })
        .where(eq(debateJobs.debateJobId, debateJobId))
        .run(),
    ).toThrow(/debate_jobs_feedback_text_check/)

    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ feedbackRating: sql<boolean>`2` })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_feedback_rating_check/)

    db.update(deepSearchJobs)
      .set({ feedbackRating: false, feedbackText: "Missing sources" })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
    db.update(ideaJobs)
      .set({ feedbackRating: false, feedbackText: "Needs more variety" })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    db.update(debateJobs)
      .set({ feedbackRating: false, feedbackText: "Weak final verdict" })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()

    expect(() =>
      db
        .update(deepSearchJobs)
        .set({ feedbackRating: true })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_feedback_text_check/)
    expect(() =>
      db
        .update(ideaJobs)
        .set({ feedbackRating: true })
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .run(),
    ).toThrow(/idea_jobs_feedback_text_check/)
    expect(() =>
      db
        .update(debateJobs)
        .set({ feedbackRating: true })
        .where(eq(debateJobs.debateJobId, debateJobId))
        .run(),
    ).toThrow(/debate_jobs_feedback_text_check/)

    for (const feedbackText of ["", "   ", "x".repeat(5001)]) {
      expect(() =>
        db
          .update(deepSearchJobs)
          .set({ feedbackText })
          .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
          .run(),
      ).toThrow(/deep_search_jobs_feedback_text_check/)
    }

    db.update(deepSearchJobs)
      .set({ feedbackRating: true, feedbackText: null })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
    db.update(deepSearchJobs)
      .set({ feedbackRating: false })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    expect(
      db
        .select({
          feedbackRating: deepSearchJobs.feedbackRating,
          feedbackText: deepSearchJobs.feedbackText,
        })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({ feedbackRating: false, feedbackText: null })

    db.update(deepSearchJobs)
      .set({ feedbackText: "Changed my mind" })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    expect(
      db
        .select({
          feedbackRating: deepSearchJobs.feedbackRating,
          feedbackText: deepSearchJobs.feedbackText,
        })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get(),
    ).toEqual({ feedbackRating: false, feedbackText: "Changed my mind" })
  })

  it("rejects completed LLM generations without text content", () => {
    for (const text of ["", "   ", "\t\n"]) {
      expect(() =>
        db
          .insert(llmGenerations)
          .values({
            llmGenerationId: crypto.randomUUID(),
            userId,
            status: "completed",
            text,
            reasoning: "",
            completedAt: new Date(),
          })
          .run(),
      ).toThrow(/llm_generations_terminal_fields_check/)
    }
  })

  it("couples query, page, and selection lifecycle fields", () => {
    const deepSearchJobId = insertDeepSearchJob()
    const { deepSearchQueryId } = insertDeepSearchQuery(deepSearchJobId)

    const summaryGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: summaryGenerationId,
        userId,
        deepSearchJobId,
      })
      .run()

    expect(() =>
      db
        .update(deepSearchQueries)
        .set({ summaryGenerationId })
        .where(sql`${deepSearchQueries.deepSearchQueryId} = ${deepSearchQueryId}`)
        .run(),
    ).toThrow(/deep_search_queries_lifecycle_check/)

    expect(() =>
      db
        .update(deepSearchQueries)
        .set({ status: "summarizing" })
        .where(sql`${deepSearchQueries.deepSearchQueryId} = ${deepSearchQueryId}`)
        .run(),
    ).toThrow(/deep_search_queries_lifecycle_check/)

    expect(() =>
      db
        .update(deepSearchQueries)
        .set({
          status: "completed",
          summaryGenerationId,
          completedAt: new Date(),
        })
        .where(sql`${deepSearchQueries.deepSearchQueryId} = ${deepSearchQueryId}`)
        .run(),
    ).toThrow(/deep_search_queries_lifecycle_check/)

    const deepSearchWebPageId = crypto.randomUUID()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId,
        url: "https://example.com/page",
      })
      .run()
    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ status: "summarizing" })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep_search_web_pages_lifecycle_check/)

    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ status: "summarizing", extractedContent: "x".repeat(100_001) })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep_search_web_pages_extracted_content_check/)

    db.update(deepSearchWebPages)
      .set({ status: "summarizing", extractedContent: "Extracted evidence" })
      .where(
        sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
      )
      .run()
    db.update(deepSearchWebPages)
      .set({ summaryGenerationId })
      .where(
        sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
      )
      .run()
    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep_search_web_pages_lifecycle_check/)
    db.update(deepSearchWebPages)
      .set({
        status: "completed",
        extractedContent: null,
        completedAt: new Date(),
      })
      .where(
        sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
      )
      .run()

    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ status: "extracting", summaryGenerationId })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep_search_web_pages_lifecycle_check/)

    const deepSearchResultId = crypto.randomUUID()
    db.insert(deepSearchResults)
      .values({
        deepSearchResultId,
        deepSearchQueryId,
        position: 0,
        title: "Result",
        shortText: "Evidence",
        url: "https://example.com/page",
      })
      .run()
    expect(() =>
      db
        .update(deepSearchResults)
        .set({ selectedWebPageId: deepSearchWebPageId })
        .where(
          sql`${deepSearchResults.deepSearchResultId} = ${deepSearchResultId}`,
        )
        .run(),
    ).not.toThrow()
  })

  it("rejects result pages owned by another deep-search job", () => {
    const queryJobId = insertDeepSearchJob()
    const pageJobId = insertDeepSearchJob()
    const { deepSearchQueryId } = insertDeepSearchQuery(queryJobId)
    const deepSearchWebPageId = crypto.randomUUID()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId: pageJobId,
        url: "https://example.com/cross-owned",
      })
      .run()

    expect(() =>
      db
        .insert(deepSearchResults)
        .values({
          deepSearchResultId: crypto.randomUUID(),
          deepSearchQueryId,
          position: 0,
          title: "Cross-owned result",
          shortText: "Evidence",
          url: "https://example.com/cross-owned",
          selectedWebPageId: deepSearchWebPageId,
        })
        .run(),
    ).toThrow(/selected result page must belong to the query deep-search job/)

    const deepSearchResultId = crypto.randomUUID()
    db.insert(deepSearchResults)
      .values({
        deepSearchResultId,
        deepSearchQueryId,
        position: 1,
        title: "Pending result",
        shortText: "Evidence",
        url: "https://example.com/cross-owned",
      })
      .run()
    expect(() =>
      db
        .update(deepSearchResults)
        .set({ selectedWebPageId: deepSearchWebPageId })
        .where(
          sql`${deepSearchResults.deepSearchResultId} = ${deepSearchResultId}`,
        )
        .run(),
    ).toThrow(/selected result page must belong to the query deep-search job/)
  })

  it("keeps selected-result ownership immutable after linking", () => {
    const queryJobId = insertDeepSearchJob()
    const otherJobId = insertDeepSearchJob()
    const query = insertDeepSearchQuery(queryJobId)
    const otherQuery = insertDeepSearchQuery(otherJobId)
    const deepSearchWebPageId = crypto.randomUUID()
    const deepSearchResultId = crypto.randomUUID()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId: queryJobId,
        url: "https://example.com/immutable",
      })
      .run()
    db.insert(deepSearchResults)
      .values({
        deepSearchResultId,
        deepSearchQueryId: query.deepSearchQueryId,
        position: 0,
        title: "Immutable result",
        shortText: "Evidence",
        url: "https://example.com/immutable",
        selectedWebPageId: deepSearchWebPageId,
      })
      .run()

    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ deepSearchJobId: otherJobId })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep-search structural columns are immutable/)
    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ url: "https://example.com/moved" })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep-search structural columns are immutable/)
    expect(() =>
      db
        .update(deepSearchRounds)
        .set({ deepSearchJobId: otherJobId })
        .where(
          sql`${deepSearchRounds.deepSearchRoundId} = ${query.deepSearchRoundId}`,
        )
        .run(),
    ).toThrow(/deep-search structural columns are immutable/)

    db.delete(deepSearchQueries)
      .where(
        sql`${deepSearchQueries.deepSearchQueryId} = ${otherQuery.deepSearchQueryId}`,
      )
      .run()
    expect(() =>
      db
        .update(deepSearchQueries)
        .set({
          deepSearchRoundId: otherQuery.deepSearchRoundId,
        })
        .where(
          sql`${deepSearchQueries.deepSearchQueryId} = ${query.deepSearchQueryId}`,
        )
        .run(),
    ).toThrow(/deep-search structural columns are immutable/)
  })

  it("requires a selected result and its page to use the same URL", () => {
    const deepSearchJobId = insertDeepSearchJob()
    const { deepSearchQueryId } = insertDeepSearchQuery(deepSearchJobId)
    const deepSearchWebPageId = crypto.randomUUID()
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId,
        deepSearchJobId,
        url: "https://example.com/page",
      })
      .run()

    expect(() =>
      db
        .insert(deepSearchResults)
        .values({
          deepSearchResultId: crypto.randomUUID(),
          deepSearchQueryId,
          position: 0,
          title: "Mismatched URL",
          shortText: "Evidence",
          url: "https://example.com/result",
          selectedWebPageId: deepSearchWebPageId,
        })
        .run(),
    ).toThrow(/selected result page must match the result URL/)

    const deepSearchResultId = crypto.randomUUID()
    db.insert(deepSearchResults)
      .values({
        deepSearchResultId,
        deepSearchQueryId,
        position: 1,
        title: "Matching URL",
        shortText: "Evidence",
        url: "https://example.com/page",
        selectedWebPageId: deepSearchWebPageId,
      })
      .run()
    expect(() =>
      db
        .update(deepSearchResults)
        .set({ url: "https://example.com/changed" })
        .where(
          sql`${deepSearchResults.deepSearchResultId} = ${deepSearchResultId}`,
        )
        .run(),
    ).toThrow(/selected result page must match the result URL/)
  })

  it("creates supporting indexes for cascade and NO ACTION lookups", () => {
    const indexes = new Set(
      db
        .all<{ name: string }>(sql`
          select name
          from sqlite_master
          where type = 'index'
        `)
        .map(({ name }) => name),
    )

    for (const name of [
      "llm_generations_debate_job_id_idx",
      "llm_generations_idea_job_id_idx",
      "llm_generations_deep_search_job_id_idx",
      "deep_search_queries_selection_generation_id_idx",
      "deep_search_queries_summary_generation_id_idx",
      "deep_search_results_selected_web_page_id_idx",
      "deep_search_web_pages_summary_generation_id_idx",
      "debate_matches_first_idea_id_idx",
      "debate_matches_second_idea_id_idx",
      "debate_matches_winner_idea_id_idx",
    ]) {
      expect(indexes.has(name), `missing index ${name}`).toBe(true)
    }
  })
})
