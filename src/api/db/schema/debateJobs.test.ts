import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "../index.ts"
import {
  debateJobs,
  debateMatches,
  debateMessages,
  debateRounds,
  ideaJobs,
  ideas,
  llmGenerations,
} from "./index.ts"

function createDebateJob() {
  const ideaJobId = crypto.randomUUID()
  const debateJobId = crypto.randomUUID()

  db.insert(debateJobs)
    .values({
      debateJobId,
      userId: "test-user-id",
      randomSeed: 1234567890,
    })
    .run()
  db.insert(ideaJobs)
    .values({
      userId: "test-user-id",
      ideaJobId,
      debateJobId,
      prompt: "Which urban transport idea should be built?",
      numberOfIdeas: 12,
      deepSearchCount: 2,
    })
    .run()
  return { debateJobId, ideaJobId }
}

function createIdea(ideaJobId: string, position: number) {
  const ideaId = crypto.randomUUID()
  const critiqueGenerationId = crypto.randomUUID()

  db.insert(llmGenerations)
    .values({
      llmGenerationId: critiqueGenerationId,
      userId: "test-user-id",
      ideaJobId,
    })
    .run()

  db.insert(ideas)
    .values({
      ideaId,
      ideaJobId,
      position,
      title: `Idea ${position + 1}`,
      description: `Description ${position + 1}`,
      critiqueGenerationId,
    })
    .run()

  return ideaId
}

function createRound(debateJobId: string) {
  const debateRoundId = crypto.randomUUID()

  db.insert(debateRounds)
    .values({
      debateRoundId,
      debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
    })
    .run()

  return debateRoundId
}

function createMatch(
  debateRoundId: string,
  firstIdeaId: string,
  secondIdeaId: string,
) {
  const debateMatchId = crypto.randomUUID()

  db.insert(debateMatches)
    .values({
      debateMatchId,
      debateRoundId,
      position: 0,
      firstIdeaId,
      secondIdeaId,
    })
    .run()

  return debateMatchId
}

describe("debate tournament schema", () => {
  it("rejects visibility values outside SQLite's boolean domain", () => {
    const { debateJobId } = createDebateJob()

    expect(() =>
      db
        .update(debateJobs)
        .set({ isPublic: sql`2` })
        .where(eq(debateJobs.debateJobId, debateJobId))
        .run(),
    ).toThrow(/CHECK constraint failed: debate_jobs_visibility_check/)
  })

  it("persists stable ideas and direct match pairings", () => {
    const { debateJobId, ideaJobId } = createDebateJob()
    const firstIdeaId = createIdea(ideaJobId, 0)
    const secondIdeaId = createIdea(ideaJobId, 1)
    const debateRoundId = createRound(debateJobId)

    createMatch(debateRoundId, firstIdeaId, secondIdeaId)

    const persisted = db.query.debateJobs.findFirst({
      where: eq(debateJobs.debateJobId, debateJobId),
      with: {
        ideaJob: { with: { ideas: true } },
        rounds: {
          with: {
            matches: {
              with: { firstIdea: true, secondIdea: true },
            },
          },
        },
      },
    }).sync()

    expect(persisted).toMatchObject({
      randomSeed: 1234567890,
      ideaJob: { ideas: [{ position: 0 }, { position: 1 }] },
    })
    expect(persisted?.rounds[0]?.matches[0]?.firstIdea.ideaId).toBe(
      firstIdeaId,
    )
  })

  it("requires a completed match winner to be one of its ideas", () => {
    const { debateJobId, ideaJobId } = createDebateJob()
    const firstIdeaId = createIdea(ideaJobId, 0)
    const secondIdeaId = createIdea(ideaJobId, 1)
    const outsiderIdeaId = createIdea(ideaJobId, 2)
    const debateRoundId = createRound(debateJobId)
    const debateMatchId = createMatch(debateRoundId, firstIdeaId, secondIdeaId)
    const completedAt = new Date()

    expect(() =>
      db
        .update(debateMatches)
        .set({
          winnerIdeaId: outsiderIdeaId,
          completedAt,
        })
        .where(eq(debateMatches.debateMatchId, debateMatchId))
        .run(),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      db
        .update(debateMatches)
        .set({ winnerIdeaId: firstIdeaId })
        .where(eq(debateMatches.debateMatchId, debateMatchId))
        .run(),
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      db
        .update(debateMatches)
        .set({ completedAt })
        .where(eq(debateMatches.debateMatchId, debateMatchId))
        .run(),
    ).toThrow(/CHECK constraint failed/)

    db.update(debateMatches)
      .set({
        winnerIdeaId: secondIdeaId,
        completedAt,
      })
      .where(eq(debateMatches.debateMatchId, debateMatchId))
      .run()

    const completedMatch = db.query.debateMatches.findFirst({
      where: eq(debateMatches.debateMatchId, debateMatchId),
    }).sync()
    expect(completedMatch?.winnerIdeaId).toBe(secondIdeaId)
    expect(completedMatch?.completedAt).toBeInstanceOf(Date)
  })

  it("orders transcript messages by creation time", () => {
    const { debateJobId, ideaJobId } = createDebateJob()
    const firstIdeaId = createIdea(ideaJobId, 0)
    const secondIdeaId = createIdea(ideaJobId, 1)
    const debateRoundId = createRound(debateJobId)
    const debateMatchId = createMatch(debateRoundId, firstIdeaId, secondIdeaId)
    const generationIds = Array.from({ length: 7 }, () => crypto.randomUUID())
    const firstCreatedAt = Date.UTC(2026, 0, 1)

    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          userId: "test-user-id",
          debateJobId,
          llmGenerationId,
        })),
      )
      .run()
    db.insert(debateMessages)
      .values(
        generationIds.map((llmGenerationId, messageIndex) => ({
          debateMessageId: crypto.randomUUID(),
          debateMatchId,
          position: messageIndex,
          speakerSlot: messageIndex === 6 ? 2 : messageIndex % 2,
          llmGenerationId,
          createdAt: new Date(firstCreatedAt + messageIndex * 1_000),
        })),
      )
      .run()

    const persisted = db.query.debateMatches.findFirst({
      where: eq(debateMatches.debateMatchId, debateMatchId),
      with: {
        messages: {
          orderBy: (message, { asc }) => [
            asc(message.createdAt),
            asc(message.debateMessageId),
          ],
          with: { llmGeneration: true },
        },
      },
    }).sync()

    expect(persisted?.messages).toHaveLength(7)
    expect(persisted?.messages.map((message) => message.speakerSlot)).toEqual([
      0, 1, 0, 1, 0, 1, 2,
    ])

    const duplicateVerdictGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values({
        userId: "test-user-id",
        debateJobId,
        llmGenerationId: duplicateVerdictGenerationId,
      })
      .run()
    expect(() =>
      db
        .insert(debateMessages)
        .values({
          debateMessageId: crypto.randomUUID(),
          debateMatchId,
          position: 7,
          speakerSlot: 2,
          llmGenerationId: duplicateVerdictGenerationId,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/)
  })

  it("preserves transcript insertion order when timestamps are equal", () => {
    const { debateJobId, ideaJobId } = createDebateJob()
    const firstIdeaId = createIdea(ideaJobId, 0)
    const secondIdeaId = createIdea(ideaJobId, 1)
    const debateRoundId = createRound(debateJobId)
    const debateMatchId = createMatch(
      debateRoundId,
      firstIdeaId,
      secondIdeaId,
    )
    const firstGenerationId = crypto.randomUUID()
    const secondGenerationId = crypto.randomUUID()
    const firstMessageId = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    const secondMessageId = "00000000-0000-4000-8000-000000000000"
    const createdAt = new Date(Date.UTC(2026, 0, 1))

    db.insert(llmGenerations)
      .values([
        {
          userId: "test-user-id",
          debateJobId,
          llmGenerationId: firstGenerationId,
        },
        {
          userId: "test-user-id",
          debateJobId,
          llmGenerationId: secondGenerationId,
        },
      ])
      .run()
    db.insert(debateMessages)
      .values([
        {
          debateMessageId: firstMessageId,
          debateMatchId,
          position: 0,
          speakerSlot: 0,
          llmGenerationId: firstGenerationId,
          createdAt,
        },
        {
          debateMessageId: secondMessageId,
          debateMatchId,
          position: 1,
          speakerSlot: 1,
          llmGenerationId: secondGenerationId,
          createdAt,
        },
      ])
      .run()

    const messages = db.query.debateMessages.findMany({
      where: eq(debateMessages.debateMatchId, debateMatchId),
      orderBy: (message, { asc }) => [
        asc(message.position),
      ],
    }).sync()

    expect(messages.map((message) => message.debateMessageId)).toEqual([
      firstMessageId,
      secondMessageId,
    ])
  })

  it("deletes the owned idea pipeline when its debate is deleted", () => {
    const { debateJobId, ideaJobId } = createDebateJob()
    const firstIdeaId = createIdea(ideaJobId, 0)
    const secondIdeaId = createIdea(ideaJobId, 1)
    const debateRoundId = createRound(debateJobId)

    createMatch(debateRoundId, firstIdeaId, secondIdeaId)

    expect(() =>
      db.delete(ideas).where(eq(ideas.ideaId, firstIdeaId)).run(),
    ).toThrow(/idea rows are immutable/)
    db.delete(debateJobs)
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
    expect(
      db
        .select()
        .from(debateJobs)
        .where(eq(debateJobs.debateJobId, debateJobId))
        .get(),
    ).toBeUndefined()
    expect(
      db
        .select()
        .from(ideaJobs)
        .where(eq(ideaJobs.ideaJobId, ideaJobId))
        .get(),
    ).toBeUndefined()
  })
})
