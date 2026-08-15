import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../index.ts"
import { debateJobs, deepSearchJobs, ideaJobs } from "./index.ts"

describe("cancellation schema constraints", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(ideaJobs).run()
  })

  it("stores cancellation only on roots", () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const deepSearchJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 42 })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        slug: `idea-${ideaJobId}`,
        prompt: "Generate ideas",
        numberOfIdeas: 6,
        deepSearchCount: 1,
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        ideaJobId,
        ideaJobPosition: 0,
        userId: "test-user-id",
        slug: `search-${deepSearchJobId}`,
        researchRequest: "Research constraints",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()

    expect(() =>
      db.update(ideaJobs)
        .set({ cancelRequestedAt: new Date() })
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .run(),
    ).toThrow(/idea_jobs_cancel_root_check/)
    expect(() =>
      db.update(deepSearchJobs)
        .set({ cancelRequestedAt: new Date() })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_cancel_root_check/)
  })

  it("retains a direct stop timestamp only for running or interrupted roots", () => {
    const deepSearchJobId = crypto.randomUUID()
    const cancelRequestedAt = new Date()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        slug: `search-${deepSearchJobId}`,
        researchRequest: "Research lifecycle constraints",
        maxSearches: 1,
        maxResultsPerSearch: 1,
        cancelRequestedAt,
      })
      .run()

    db.update(deepSearchJobs)
      .set({ status: "interrupted", error: "Stopped", completedAt: new Date() })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
    expect(
      db.select({ cancelRequestedAt: deepSearchJobs.cancelRequestedAt })
        .from(deepSearchJobs)
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .get()?.cancelRequestedAt,
    ).toEqual(cancelRequestedAt)
    expect(() =>
      db.update(deepSearchJobs)
        .set({ status: "failed" })
        .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
        .run(),
    ).toThrow(/deep_search_jobs_terminal_fields_check/)
  })
})
