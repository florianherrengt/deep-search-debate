import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import {
  completeDeepSearchJob,
  failDeepSearchJob,
  promoteRoundAnswer,
} from "./jobLifecycle.ts"
import {
  attachFinalAnswerGeneration,
  createSearchRound,
  attachQuerySummaryGeneration,
  attachRoundAnswerGeneration,
  attachSelectionGeneration,
  completeQuerySummaryGeneration,
  savePlannedQueries,
  saveSearchResults,
} from "./store.ts"

function insertJob(jobId: string): void {
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId: jobId,
      userId: "test-user-id",
      slug: `job-${jobId}`,
      researchRequest: "Research this",
      maxSearches: 2,
      maxResultsPerSearch: 2,
    })
    .run()
}

function insertGeneration(jobId: string, generationId: string): void {
  db.insert(llmGenerations)
    .values({
      llmGenerationId: generationId,
      userId: "test-user-id",
      deepSearchJobId: jobId,
    })
    .run()
}

function completeGeneration(generationId: string, text: string): void {
  db.update(llmGenerations)
    .set({
      status: "completed",
      text,
      reasoning: "",
      completedAt: new Date(),
    })
    .where(eq(llmGenerations.llmGenerationId, generationId))
    .run()
}

function createQuery(jobId: string) {
  const queryGenerationId = crypto.randomUUID()
  const selectionGenerationId = crypto.randomUUID()
  const summaryGenerationId = crypto.randomUUID()
  for (const generationId of [
    queryGenerationId,
    selectionGenerationId,
    summaryGenerationId,
  ]) {
    insertGeneration(jobId, generationId)
  }
  const round = createSearchRound({
    jobId,
    position: 0,
    generationId: queryGenerationId,
  })
  const [plannedQuery] = savePlannedQueries({
    jobId,
    roundId: round.roundId,
    queries: ["stable query"],
  })
  if (!plannedQuery) throw new Error("Planned query was not returned")
  const [query] = saveSearchResults({
    jobId,
    roundId: round.roundId,
    searches: [{ plannedQuery, results: [] }],
  })
  if (!query) throw new Error("Search query was not returned")
  return {
    query,
    queryGenerationId,
    selectionGenerationId,
    summaryGenerationId,
  }
}

function attachFinalGeneration(jobId: string, generationId: string): void {
  insertGeneration(jobId, generationId)
  db.transaction((transaction) => {
    attachFinalAnswerGeneration(transaction, {
      jobId,
      generationId,
    })
  })
}

describe("deep-search job lifecycle", () => {
  beforeEach(() => {
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it("completes the final generation and job in one transaction", () => {
    const jobId = crypto.randomUUID()
    const finalGenerationId = crypto.randomUUID()
    insertJob(jobId)
    const queryStage = createQuery(jobId)
    completeGeneration(queryStage.queryGenerationId, '["stable query"]')
    completeGeneration(queryStage.selectionGenerationId, "[]")
    attachSelectionGeneration({
      jobId,
      queryId: queryStage.query.queryId,
      generationId: queryStage.selectionGenerationId,
    })
    db.transaction((transaction) => {
      attachQuerySummaryGeneration(transaction, {
        jobId,
        queryId: queryStage.query.queryId,
        generationId: queryStage.summaryGenerationId,
      })
    })
    db.transaction((transaction) => {
      transaction
        .update(llmGenerations)
        .set({
          status: "completed",
          text: "Query summary",
          reasoning: "",
          completedAt: new Date(),
        })
        .where(
          eq(
            llmGenerations.llmGenerationId,
            queryStage.summaryGenerationId,
          ),
        )
        .run()
      completeQuerySummaryGeneration(transaction, {
        jobId,
        queryId: queryStage.query.queryId,
        generationId: queryStage.summaryGenerationId,
      })
    })
    attachFinalGeneration(jobId, finalGenerationId)

    db.transaction((transaction) => {
      transaction
        .update(llmGenerations)
        .set({
          status: "completed",
          text: "Final answer",
          reasoning: "Final reasoning",
          completedAt: new Date(),
        })
        .where(eq(llmGenerations.llmGenerationId, finalGenerationId))
        .run()
      completeDeepSearchJob(transaction, {
        jobId,
        generationId: finalGenerationId,
      })
    })

    expect(
      db
        .select({
          status: deepSearchJobs.status,
          completedAt: deepSearchJobs.completedAt,
        })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, jobId))
        .get(),
    ).toMatchObject({ status: "completed" })
    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, finalGenerationId))
        .get(),
    ).toEqual({ status: "completed" })
  })

  it("rolls back final generation completion when a query is incomplete", () => {
    const jobId = crypto.randomUUID()
    const finalGenerationId = crypto.randomUUID()
    insertJob(jobId)
    createQuery(jobId)
    attachFinalGeneration(jobId, finalGenerationId)

    expect(() =>
      db.transaction((transaction) => {
        transaction
          .update(llmGenerations)
          .set({
            status: "completed",
            text: "Premature answer",
            reasoning: "",
            completedAt: new Date(),
          })
          .where(eq(llmGenerations.llmGenerationId, finalGenerationId))
          .run()
        completeDeepSearchJob(transaction, {
          jobId,
          generationId: finalGenerationId,
        })
      }),
    ).toThrow("Every search query must complete")

    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, finalGenerationId))
        .get(),
    ).toEqual({ status: "running" })
    expect(
      db
        .select({ status: deepSearchJobs.status })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, jobId))
        .get(),
    ).toEqual({ status: "running" })
  })

  it("promotes a completed round answer without copying its output", () => {
    const jobId = crypto.randomUUID()
    const queryGenerationId = crypto.randomUUID()
    const answerGenerationId = crypto.randomUUID()
    insertJob(jobId)
    insertGeneration(jobId, queryGenerationId)
    insertGeneration(jobId, answerGenerationId)
    completeGeneration(queryGenerationId, '["stable query"]')
    completeGeneration(answerGenerationId, "Candidate answer")
    const round = createSearchRound({
      jobId,
      position: 0,
      generationId: queryGenerationId,
    })
    db.transaction((transaction) => {
      attachRoundAnswerGeneration(transaction, {
        jobId,
        roundId: round.roundId,
        generationId: answerGenerationId,
      })
    })

    promoteRoundAnswer({
      jobId,
      roundId: round.roundId,
      generationId: answerGenerationId,
    })

    expect(
      db
        .select({
          status: deepSearchJobs.status,
          finalAnswerGenerationId: deepSearchJobs.finalAnswerGenerationId,
        })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, jobId))
        .get(),
    ).toEqual({
      status: "completed",
      finalAnswerGenerationId: answerGenerationId,
    })
    expect(
      db
        .select({ answerGenerationId: deepSearchRounds.answerGenerationId })
        .from(deepSearchRounds)
        .where(eq(deepSearchRounds.deepSearchRoundId, round.roundId))
        .get(),
    ).toEqual({ answerGenerationId })
  })

  it("fails all active work with one error and completion timestamp", () => {
    const jobId = crypto.randomUUID()
    const pageGenerationId = crypto.randomUUID()
    insertJob(jobId)
    const queryStage = createQuery(jobId)
    insertGeneration(jobId, pageGenerationId)
    db.insert(deepSearchWebPages)
      .values({
        deepSearchWebPageId: crypto.randomUUID(),
        deepSearchJobId: jobId,
        url: "https://example.com/active",
        status: "summarizing",
        summaryGenerationId: pageGenerationId,
      })
      .run()

    failDeepSearchJob(jobId, "Root pipeline failure")

    const job = db
      .select()
      .from(deepSearchJobs)
      .where(eq(deepSearchJobs.deepSearchJobId, jobId))
      .get()
    const query = db
      .select()
      .from(deepSearchQueries)
      .where(
        eq(deepSearchQueries.deepSearchQueryId, queryStage.query.queryId),
      )
      .get()
    const page = db
      .select()
      .from(deepSearchWebPages)
      .where(eq(deepSearchWebPages.deepSearchJobId, jobId))
      .get()
    expect(job).toMatchObject({
      status: "failed",
      error: "Root pipeline failure",
    })
    expect(query).toMatchObject({
      status: "failed",
      errorStage: "selection",
      errorMessage: "Root pipeline failure",
    })
    expect(page).toMatchObject({
      status: "failed",
      errorStage: "summary",
      errorMessage: "Root pipeline failure",
    })
    expect(job?.completedAt?.getTime()).toBe(query?.completedAt?.getTime())
    expect(job?.completedAt?.getTime()).toBe(page?.completedAt?.getTime())
  })
})
