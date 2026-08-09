import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueryGenerations,
  llmGenerations,
} from "../../db/schema/index.ts"
import { persistDeepSearchEvent } from "./eventPersistence.ts"

describe("deep-search event ownership", () => {
  it("rejects a generation owned by another deep-search job", () => {
    const deepSearchJobId = crypto.randomUUID()
    const foreignDeepSearchJobId = crypto.randomUUID()
    const llmGenerationId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values([
        {
          deepSearchJobId,
          userId: "test-user-id",
          slug: `search-${deepSearchJobId}`,
          researchRequest: "Research this",
          maxSearches: 1,
          maxResultsPerSearch: 1,
        },
        {
          deepSearchJobId: foreignDeepSearchJobId,
          userId: "test-user-id",
          slug: `search-${foreignDeepSearchJobId}`,
          researchRequest: "Research something else",
          maxSearches: 1,
          maxResultsPerSearch: 1,
        },
      ])
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId,
        userId: "test-user-id",
        deepSearchJobId: foreignDeepSearchJobId,
      })
      .run()

    expect(() =>
      persistDeepSearchEvent(deepSearchJobId, {
        type: "query-stream",
        streamId: llmGenerationId,
      }),
    ).toThrow("LLM generation must belong to the deep-search job owner")
    expect(
      db
        .select()
        .from(deepSearchQueryGenerations)
        .where(
          eq(deepSearchQueryGenerations.deepSearchJobId, deepSearchJobId),
        )
        .all(),
    ).toEqual([])
  })
})
