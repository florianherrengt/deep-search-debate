import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../index.ts"
import {
  account,
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
  user,
} from "./index.ts"

function insertUser(label: string): string {
  const userId = crypto.randomUUID()
  db.insert(user)
    .values({
      id: userId,
      name: label,
      email: `${userId}@example.test`,
      emailVerified: true,
    })
    .run()
  return userId
}

describe("database ownership constraints", () => {
  it("makes each provider account identity globally unique", () => {
    const firstUserId = insertUser("First OAuth user")
    const secondUserId = insertUser("Second OAuth user")

    db.insert(account)
      .values({
        id: crypto.randomUUID(),
        accountId: "github-user-123",
        providerId: "github",
        userId: firstUserId,
        updatedAt: new Date(),
      })
      .run()

    expect(() =>
      db
        .insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: "github-user-123",
          providerId: "github",
          userId: secondUserId,
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
  })

  it("rejects root relationships whose owners differ", () => {
    const firstUserId = insertUser("First owner")
    const secondUserId = insertUser("Second owner")
    const ideaJobId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()

    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: secondUserId,
        randomSeed: 1,
      })
      .run()

    expect(() =>
      db
        .insert(ideaJobs)
        .values({
          ideaJobId: crypto.randomUUID(),
          debateJobId,
          userId: firstUserId,
          slug: crypto.randomUUID(),
          prompt: "Generate debate ideas",
          numberOfIdeas: 1,
          deepSearchCount: 1,
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: firstUserId,
        slug: crypto.randomUUID(),
        prompt: "Generate ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      })
      .run()

    expect(() =>
      db
        .insert(deepSearchJobs)
        .values({
          deepSearchJobId: crypto.randomUUID(),
          userId: secondUserId,
          slug: crypto.randomUUID(),
          ideaJobId,
          ideaJobPosition: 0,
          researchRequest: "Research this",
          maxSearches: 1,
          maxResultsPerSearch: 1,
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  it("rejects root generation links whose owners differ", () => {
    const firstUserId = insertUser("Job owner")
    const secondUserId = insertUser("Generation owner")
    const llmGenerationId = crypto.randomUUID()

    db.insert(llmGenerations)
      .values({ llmGenerationId, userId: secondUserId })
      .run()

    expect(() =>
      db
        .insert(ideaJobs)
        .values({
          ideaJobId: crypto.randomUUID(),
          userId: firstUserId,
          slug: crypto.randomUUID(),
          prompt: "Generate ideas",
          numberOfIdeas: 1,
          deepSearchCount: 1,
          researchPromptGenerationId: llmGenerationId,
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)

    const ideaJobId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: firstUserId,
        slug: crypto.randomUUID(),
        prompt: "Select ideas",
        numberOfIdeas: 6,
        deepSearchCount: 1,
      })
      .run()
    expect(() =>
      db
        .update(ideaJobs)
        .set({ selectionGenerationId: llmGenerationId })
        .where(sql`${ideaJobs.ideaJobId} = ${ideaJobId}`)
        .run(),
    ).toThrow(/selection generation must belong to the idea job owner/)

    expect(() =>
      db
        .insert(deepSearchJobs)
        .values({
          deepSearchJobId: crypto.randomUUID(),
          userId: firstUserId,
          slug: crypto.randomUUID(),
          researchRequest: "Research this",
          maxSearches: 1,
          maxResultsPerSearch: 1,
          finalAnswerGenerationId: llmGenerationId,
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  it("stores domain timestamp defaults as Unix milliseconds", () => {
    const userId = insertUser("Timestamp owner")
    const llmGenerationId = crypto.randomUUID()
    db.insert(llmGenerations).values({ llmGenerationId, userId }).run()

    const row = db.get<{ startedAt: number }>(sql`
      select started_at as startedAt
      from llm_generations
      where llm_generation_id = ${llmGenerationId}
    `)

    expect(row.startedAt).toBeGreaterThan(1_000_000_000_000)
  })
})
