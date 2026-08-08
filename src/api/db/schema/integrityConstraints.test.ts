import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../index.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchQueryGenerations,
  deepSearchResults,
  deepSearchWebPages,
  ideaJobs,
  ideas,
  llmGenerations,
} from "./index.ts"

const userId = "test-user-id"

function insertIdeaJob(): string {
  const ideaJobId = crypto.randomUUID()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      userId,
      prompt: "Generate ideas",
      numberOfIdeas: 1,
      deepSearchCount: 1,
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
      researchRequest: "Research this",
      maxSearches: 1,
      maxResultsPerSearch: 1,
    })
    .run()
  return deepSearchJobId
}

function insertDeepSearchQuery(deepSearchJobId: string): {
  deepSearchGeneratedQueryId: string
  deepSearchQueryGenerationId: string
  deepSearchQueryId: string
} {
  const llmGenerationId = crypto.randomUUID()
  db.insert(llmGenerations)
    .values({ llmGenerationId, userId, deepSearchJobId })
    .run()

  const deepSearchQueryGenerationId = crypto.randomUUID()
  db.insert(deepSearchQueryGenerations)
    .values({
      deepSearchQueryGenerationId,
      deepSearchJobId,
      llmGenerationId,
    })
    .run()

  const deepSearchGeneratedQueryId = crypto.randomUUID()
  db.insert(deepSearchGeneratedQueries)
    .values({
      deepSearchGeneratedQueryId,
      deepSearchQueryGenerationId,
      position: 0,
      query: "research query",
    })
    .run()

  const deepSearchQueryId = crypto.randomUUID()
  db.insert(deepSearchQueries)
    .values({ deepSearchQueryId, deepSearchGeneratedQueryId })
    .run()
  return {
    deepSearchGeneratedQueryId,
    deepSearchQueryGenerationId,
    deepSearchQueryId,
  }
}

describe("aggregate integrity constraints", () => {
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
  })

  it("keeps generation ownership immutable after insertion", () => {
    const firstDeepSearchJobId = insertDeepSearchJob()
    const secondDeepSearchJobId = insertDeepSearchJob()
    const llmGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({ llmGenerationId, userId, deepSearchJobId: firstDeepSearchJobId })
      .run()
    db.insert(deepSearchQueryGenerations)
      .values({
        deepSearchQueryGenerationId: crypto.randomUUID(),
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
        critiqueGenerationId: generationIds[3],
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
          critiqueGenerationId: generationIds[3],
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

  it("allows ideas before critique and attaches each critique only once", () => {
    const ideaJobId = insertIdeaJob()
    const critiqueGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({ llmGenerationId: critiqueGenerationId, userId, ideaJobId })
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
      { critiqueGenerationId: null },
      { critiqueGenerationId: null },
    ])
    db.update(ideas)
      .set({ critiqueGenerationId })
      .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
      .run()

    expect(() =>
      db
        .update(ideas)
        .set({ critiqueGenerationId })
        .where(sql`${ideas.ideaId} = ${secondIdeaId}`)
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
    expect(() =>
      db
        .update(ideas)
        .set({ critiqueGenerationId: crypto.randomUUID() })
        .where(sql`${ideas.ideaId} = ${secondIdeaId}`)
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() =>
      db
        .update(ideas)
        .set({ critiqueGenerationId: null })
        .where(sql`${ideas.ideaId} = ${firstIdeaId}`)
        .run(),
    ).toThrow(/one-time critique linkage/)
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
        })
        .run(),
    ).toThrow(/deep_search_jobs_research_request_content_check/)

    const deepSearchJobId = insertDeepSearchJob()
    const llmGenerationId = crypto.randomUUID()
    const deepSearchQueryGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({ llmGenerationId, userId, deepSearchJobId })
      .run()
    db.insert(deepSearchQueryGenerations)
      .values({
        deepSearchQueryGenerationId,
        deepSearchJobId,
        llmGenerationId,
      })
      .run()
    expect(() =>
      db
        .insert(deepSearchGeneratedQueries)
        .values({
          deepSearchGeneratedQueryId: crypto.randomUUID(),
          deepSearchQueryGenerationId,
          position: 0,
          query: "   ",
        })
        .run(),
    ).toThrow(/deep_search_generated_queries_content_check/)
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
        .set({ status: "completed", completedAt: new Date() })
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
        .set({ status: "extracting", summaryGenerationId })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep_search_web_pages_lifecycle_check/)

    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ status: "completed", completedAt: new Date() })
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
        .set({ selectionStatus: "selected" })
        .where(
          sql`${deepSearchResults.deepSearchResultId} = ${deepSearchResultId}`,
        )
        .run(),
    ).toThrow(/deep_search_results_selection_page_check/)

    expect(() =>
      db
        .update(deepSearchResults)
        .set({ selectionStatus: "selected", deepSearchWebPageId })
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
          selectionStatus: "selected",
          deepSearchWebPageId,
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
        .set({ selectionStatus: "selected", deepSearchWebPageId })
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
        selectionStatus: "selected",
        deepSearchWebPageId,
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
    ).toThrow(/deep-search ownership columns are immutable/)
    expect(() =>
      db
        .update(deepSearchWebPages)
        .set({ url: "https://example.com/moved" })
        .where(
          sql`${deepSearchWebPages.deepSearchWebPageId} = ${deepSearchWebPageId}`,
        )
        .run(),
    ).toThrow(/deep-search ownership columns are immutable/)
    expect(() =>
      db
        .update(deepSearchQueryGenerations)
        .set({ deepSearchJobId: otherJobId })
        .where(
          sql`${deepSearchQueryGenerations.deepSearchQueryGenerationId} = ${query.deepSearchQueryGenerationId}`,
        )
        .run(),
    ).toThrow(/deep-search ownership columns are immutable/)

    db.update(deepSearchGeneratedQueries)
      .set({ position: 1 })
      .where(
        sql`${deepSearchGeneratedQueries.deepSearchGeneratedQueryId} = ${otherQuery.deepSearchGeneratedQueryId}`,
      )
      .run()
    expect(() =>
      db
        .update(deepSearchGeneratedQueries)
        .set({
          deepSearchQueryGenerationId:
            otherQuery.deepSearchQueryGenerationId,
        })
        .where(
          sql`${deepSearchGeneratedQueries.deepSearchGeneratedQueryId} = ${query.deepSearchGeneratedQueryId}`,
        )
        .run(),
    ).toThrow(/deep-search ownership columns are immutable/)

    db.delete(deepSearchQueries)
      .where(
        sql`${deepSearchQueries.deepSearchQueryId} = ${otherQuery.deepSearchQueryId}`,
      )
      .run()
    expect(() =>
      db
        .update(deepSearchQueries)
        .set({
          deepSearchGeneratedQueryId:
            otherQuery.deepSearchGeneratedQueryId,
        })
        .where(
          sql`${deepSearchQueries.deepSearchQueryId} = ${query.deepSearchQueryId}`,
        )
        .run(),
    ).toThrow(/deep-search ownership columns are immutable/)
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
          selectionStatus: "selected",
          deepSearchWebPageId,
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
        selectionStatus: "selected",
        deepSearchWebPageId,
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
      "deep_search_results_web_page_id_idx",
      "deep_search_web_pages_summary_generation_id_idx",
      "debate_matches_first_idea_id_idx",
      "debate_matches_second_idea_id_idx",
      "debate_matches_winner_idea_id_idx",
    ]) {
      expect(indexes.has(name), `missing index ${name}`).toBe(true)
    }
  })
})
