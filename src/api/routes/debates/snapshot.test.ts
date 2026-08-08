import { describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  debateJobs,
  debateMatches,
  debateMessages,
  debateRounds,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { getDebateJobSnapshot } from "./snapshot.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./tournament.ts"

describe("debate job snapshot", () => {
  it("derives standings and exposes transcript text without raw judge JSON", () => {
    const ideaJobId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()
    const debateRoundId = crypto.randomUUID()
    const ideaRows = Array.from(
      { length: DEBATE_TOURNAMENT_FORMAT.participantCount },
      (_, position) => ({
        ideaId: crypto.randomUUID(),
        ideaJobId,
        position,
        title: `Idea ${position + 1}`,
        description: `Description ${position + 1}`,
        critiqueGenerationId: crypto.randomUUID(),
      }),
    )

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
        userId: "test-user-id",
        ideaJobId,
        debateJobId,
        prompt: "Choose an energy-saving product",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 2,
      })
      .run()
    db.insert(llmGenerations)
      .values(
        ideaRows.map(({ critiqueGenerationId }) => ({
          llmGenerationId: critiqueGenerationId,
          userId: "test-user-id",
          ideaJobId,
        })),
      )
      .run()
    db.insert(ideas).values(ideaRows).run()
    db.insert(debateRounds)
      .values({
        debateRoundId,
        debateJobId,
        stage: "swiss",
        stageRoundNumber: 1,
      })
      .run()

    const completedAt = new Date()
    const matches = Array.from(
      { length: DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound },
      (_, position) => ({
        debateMatchId: crypto.randomUUID(),
        debateRoundId,
        position,
        firstIdeaId: ideaRows[position * 2].ideaId,
        secondIdeaId: ideaRows[position * 2 + 1].ideaId,
        winnerIdeaId: ideaRows[position * 2].ideaId,
        completedAt,
      }),
    )
    db.insert(debateMatches).values(matches).run()

    const openingGenerationId = crypto.randomUUID()
    const judgeGenerationId = crypto.randomUUID()
    db.insert(llmGenerations)
      .values([
        {
          userId: "test-user-id",
          debateJobId,
          llmGenerationId: openingGenerationId,
          status: "completed",
          text: "Opening argument",
          reasoning: "",
          completedAt,
        },
        {
          userId: "test-user-id",
          debateJobId,
          llmGenerationId: judgeGenerationId,
          status: "completed",
          text: JSON.stringify({
            winnerSlot: 0,
            explanation: "Candidate A is more practical.",
          }),
          reasoning: "",
          completedAt,
        },
      ])
      .run()
    db.insert(debateMessages)
      .values([
        {
          debateMessageId: crypto.randomUUID(),
          debateMatchId: matches[0].debateMatchId,
          position: 4,
          speakerSlot: 2,
          llmGenerationId: judgeGenerationId,
          createdAt: completedAt,
        },
        {
          debateMessageId: crypto.randomUUID(),
          debateMatchId: matches[0].debateMatchId,
          position: 0,
          speakerSlot: 0,
          llmGenerationId: openingGenerationId,
          createdAt: completedAt,
        },
      ])
      .run()

    const snapshot = getDebateJobSnapshot(debateJobId)

    expect(snapshot).toMatchObject({
      debateJobId,
      ideaJobId,
      prompt: "Choose an energy-saving product",
      expectedMatchCount: DEBATE_TOURNAMENT_FORMAT.totalMatchCount,
      stage: "swiss",
      status: "running",
    })
    expect(snapshot?.rounds[0]?.matches[0]).toMatchObject({
      status: "completed",
      firstIdea: { ideaId: ideaRows[0].ideaId },
      secondIdea: { ideaId: ideaRows[1].ideaId },
    })
    expect(snapshot?.rounds[0]?.matches[0]?.messages.map(({ text }) => text)).toEqual([
      "Opening argument",
      "Candidate A is more practical.",
    ])
    expect(snapshot?.standings).toHaveLength(
      DEBATE_TOURNAMENT_FORMAT.participantCount,
    )
    expect(
      snapshot?.standings.reduce((sum, standing) => sum + standing.wins, 0),
    ).toBe(DEBATE_TOURNAMENT_FORMAT.matchesPerSwissRound)
  })

  it("returns an empty projection while the idea stage has no ideas yet", () => {
    const ideaJobId = crypto.randomUUID()
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 7,
      })
      .run()
    db.insert(ideaJobs)
      .values({
        userId: "test-user-id",
        ideaJobId,
        debateJobId,
        prompt: "Generate then debate ideas",
        numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
        deepSearchCount: 2,
      })
      .run()
    expect(getDebateJobSnapshot(debateJobId)).toMatchObject({
      stage: "ideas",
      rounds: [],
      standings: [],
    })
  })
})
