import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"

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
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"
import {
  DEBATE_TOURNAMENT_FORMAT,
  getMatchesPerSwissRound,
} from "./tournament.ts"

export type DebateRoundStage = "swiss" | "semifinal" | "final"
export type IdeaPair = readonly [string, string]

type CreatedMatch = {
  debateMatchId: string
  position: number
  firstIdeaId: string
  secondIdeaId: string
}

function assertDebateActive(
  transaction: TextStreamPersistenceTransaction,
  debateJobId: string,
): void {
  assertEffectiveResearchRootRunning(transaction, {
    kind: "debate",
    jobId: debateJobId,
  })
}

function canonicalPair(firstIdeaId: string, secondIdeaId: string): string {
  return [firstIdeaId, secondIdeaId].sort().join(":")
}

function assertGenerationOwnedByMatch(
  transaction: TextStreamPersistenceTransaction,
  debateMatchId: string,
  llmGenerationId: string,
): void {
  const ownedGeneration = transaction
    .select({ llmGenerationId: llmGenerations.llmGenerationId })
    .from(debateMatches)
    .innerJoin(
      debateRounds,
      eq(debateMatches.debateRoundId, debateRounds.debateRoundId),
    )
    .innerJoin(
      debateJobs,
      eq(debateRounds.debateJobId, debateJobs.debateJobId),
    )
    .innerJoin(
      llmGenerations,
      and(
        eq(llmGenerations.llmGenerationId, llmGenerationId),
        eq(llmGenerations.debateJobId, debateJobs.debateJobId),
      ),
    )
    .where(eq(debateMatches.debateMatchId, debateMatchId))
    .get()
  if (!ownedGeneration) {
    throw new Error("LLM generation must belong to the debate job owner")
  }
}

function requireActiveMatch(
  transaction: TextStreamPersistenceTransaction,
  debateMatchId: string,
) {
  const match = transaction
    .select({
      debateJobId: debateRounds.debateJobId,
      firstIdeaId: debateMatches.firstIdeaId,
      secondIdeaId: debateMatches.secondIdeaId,
    })
    .from(debateMatches)
    .innerJoin(
      debateRounds,
      eq(debateMatches.debateRoundId, debateRounds.debateRoundId),
    )
    .where(eq(debateMatches.debateMatchId, debateMatchId))
    .get()
  if (!match) throw new Error("Debate match was not found")
  assertDebateActive(transaction, match.debateJobId)
  return match
}

function expectedMatchCount(
  stage: DebateRoundStage,
  participantCount: number,
): number {
  if (stage === "swiss") {
    return getMatchesPerSwissRound(participantCount)
  }
  if (stage === "semifinal") {
    return DEBATE_TOURNAMENT_FORMAT.semifinalMatchCount
  }
  return DEBATE_TOURNAMENT_FORMAT.finalMatchCount
}

function validatePriorRounds(
  transaction: TextStreamPersistenceTransaction,
  debateJobId: string,
  stage: DebateRoundStage,
  stageRoundNumber: number,
  matchesPerSwissRound: number,
): void {
  const rounds = transaction
    .select({
      stage: debateRounds.stage,
      stageRoundNumber: debateRounds.stageRoundNumber,
      winnerIdeaId: debateMatches.winnerIdeaId,
    })
    .from(debateRounds)
    .leftJoin(
      debateMatches,
      eq(debateMatches.debateRoundId, debateRounds.debateRoundId),
    )
    .where(eq(debateRounds.debateJobId, debateJobId))
    .all()

  const isComplete = (
    expectedStage: DebateRoundStage,
    expectedNumber: number,
    matchCount: number,
  ) => {
    const matches = rounds.filter(
      (round) =>
        round.stage === expectedStage &&
        round.stageRoundNumber === expectedNumber,
    )
    return (
      matches.length === matchCount &&
      matches.every((match) => match.winnerIdeaId !== null)
    )
  }

  if (stage === "swiss") {
    if (
      stageRoundNumber < 1 ||
      stageRoundNumber > DEBATE_TOURNAMENT_FORMAT.swissRounds
    ) {
      throw new Error(
        `Swiss round number must be between 1 and ${DEBATE_TOURNAMENT_FORMAT.swissRounds}`,
      )
    }
    if (
      stageRoundNumber > 1 &&
      !isComplete(
        "swiss",
        stageRoundNumber - 1,
        matchesPerSwissRound,
      )
    ) {
      throw new Error("The previous Swiss round is incomplete")
    }
    return
  }

  for (
    let roundNumber = 1;
    roundNumber <= DEBATE_TOURNAMENT_FORMAT.swissRounds;
    roundNumber += 1
  ) {
    if (
      !isComplete(
        "swiss",
        roundNumber,
        matchesPerSwissRound,
      )
    ) {
      throw new Error(
        `All ${DEBATE_TOURNAMENT_FORMAT.swissRounds} Swiss rounds must complete before knockout`,
      )
    }
  }
  if (
    stage === "final" &&
    !isComplete(
      "semifinal",
      1,
      DEBATE_TOURNAMENT_FORMAT.semifinalMatchCount,
    )
  ) {
    throw new Error("Both semifinals must complete before the final")
  }
}

/** Validates tournament-wide invariants before atomically creating a round. */
export function createDebateRound(input: {
  debateJobId: string
  stage: DebateRoundStage
  stageRoundNumber: number
  pairs: IdeaPair[]
}): CreatedMatch[] {
  return db.transaction((transaction) => {
    assertDebateActive(transaction, input.debateJobId)
    const job = transaction
      .select({
        ideaJobId: ideaJobs.ideaJobId,
        stage: debateJobs.stage,
        status: debateJobs.status,
      })
      .from(debateJobs)
      .innerJoin(ideaJobs, eq(ideaJobs.debateJobId, debateJobs.debateJobId))
      .where(eq(debateJobs.debateJobId, input.debateJobId))
      .get()
    if (!job) throw new Error("Debate job was not found")
    if (job.status !== "running" || job.stage !== input.stage) {
      throw new Error(`Debate job is not running the ${input.stage} stage`)
    }
    const admittedIdeas = new Set(
      transaction
        .select({ ideaId: ideas.ideaId })
        .from(ideas)
        .where(
          and(
            eq(ideas.ideaJobId, job.ideaJobId),
            eq(ideas.selected, true),
          ),
        )
        .all()
        .map((idea) => idea.ideaId),
    )
    const matchesPerSwissRound = getMatchesPerSwissRound(admittedIdeas.size)
    if (
      input.pairs.length !==
      expectedMatchCount(input.stage, admittedIdeas.size)
    ) {
      throw new Error(`Incorrect number of ${input.stage} matches`)
    }

    const participantIds = input.pairs.flatMap((pair) => [...pair])
    if (new Set(participantIds).size !== participantIds.length) {
      throw new Error("An idea cannot appear more than once in a round")
    }
    if (participantIds.some((ideaId) => !admittedIdeas.has(ideaId))) {
      throw new Error("Every match idea must be selected for this debate")
    }

    validatePriorRounds(
      transaction,
      input.debateJobId,
      input.stage,
      input.stageRoundNumber,
      matchesPerSwissRound,
    )

    if (input.stage === "swiss") {
      const previousPairs = new Set(
        transaction
          .select({
            firstIdeaId: debateMatches.firstIdeaId,
            secondIdeaId: debateMatches.secondIdeaId,
          })
          .from(debateMatches)
          .innerJoin(
            debateRounds,
            eq(debateMatches.debateRoundId, debateRounds.debateRoundId),
          )
          .where(
            and(
              eq(debateRounds.debateJobId, input.debateJobId),
              eq(debateRounds.stage, "swiss"),
            ),
          )
          .all()
          .map((match) =>
            canonicalPair(match.firstIdeaId, match.secondIdeaId),
          ),
      )
      if (
        input.pairs.some((pair) => previousPairs.has(canonicalPair(...pair)))
      ) {
        throw new Error("Swiss matchups cannot repeat")
      }
    }

    const debateRoundId = randomUUID()
    const matches = input.pairs.map(
      ([firstIdeaId, secondIdeaId], position): CreatedMatch => ({
        debateMatchId: randomUUID(),
        position,
        firstIdeaId,
        secondIdeaId,
      }),
    )
    transaction
      .insert(debateRounds)
      .values({
        debateRoundId,
        debateJobId: input.debateJobId,
        stage: input.stage,
        stageRoundNumber: input.stageRoundNumber,
      })
      .run()
    transaction
      .insert(debateMatches)
      .values(
        matches.map((match) => ({
          ...match,
          debateRoundId,
        })),
      )
      .run()
    return matches
  })
}

export function createAgentMessage(input: {
  debateMatchId: string
  position: number
  speakerSlot: 0 | 1
  llmGenerationId: string
}, transaction: TextStreamPersistenceTransaction): void {
  requireActiveMatch(transaction, input.debateMatchId)
  assertGenerationOwnedByMatch(
    transaction,
    input.debateMatchId,
    input.llmGenerationId,
  )
  transaction
    .insert(debateMessages)
    .values({ debateMessageId: randomUUID(), ...input })
    .run()
}

/** Repoints only the exact failed `other` attempt that authorized a retry. */
export function replaceFailedAgentMessageGeneration(input: {
  debateMatchId: string
  position: number
  failedGenerationId: string
  retryGenerationId: string
}, transaction: TextStreamPersistenceTransaction): void {
  requireActiveMatch(transaction, input.debateMatchId)
  assertGenerationOwnedByMatch(
    transaction,
    input.debateMatchId,
    input.retryGenerationId,
  )
  const failedAttempt = transaction
    .select({ llmGenerationId: llmGenerations.llmGenerationId })
    .from(llmGenerations)
    .where(
      and(
        eq(llmGenerations.llmGenerationId, input.failedGenerationId),
        eq(llmGenerations.status, "failed"),
        eq(llmGenerations.finishReason, "other"),
      ),
    )
    .get()
  if (!failedAttempt) {
    throw new Error("The replaced generation is not a failed other finish")
  }
  const replacement = transaction
    .update(debateMessages)
    .set({ llmGenerationId: input.retryGenerationId })
    .where(
      and(
        eq(debateMessages.debateMatchId, input.debateMatchId),
        eq(debateMessages.position, input.position),
        eq(debateMessages.llmGenerationId, input.failedGenerationId),
      ),
    )
    .run()
  if (replacement.changes !== 1) {
    throw new Error("The failed debate message generation link changed")
  }
}

/** Adds the judge link and machine result to the generation's terminal transaction. */
export function completeDebateMatch(input: {
  debateMatchId: string
  winnerIdeaId: string
  judgeGenerationId: string
}, transaction: TextStreamPersistenceTransaction): void {
  const match = requireActiveMatch(transaction, input.debateMatchId)
  if (
    input.winnerIdeaId !== match.firstIdeaId &&
    input.winnerIdeaId !== match.secondIdeaId
  ) {
    throw new Error("Debate winner must belong to the match")
  }
  assertGenerationOwnedByMatch(
    transaction,
    input.debateMatchId,
    input.judgeGenerationId,
  )
  transaction
    .insert(debateMessages)
    .values({
      debateMessageId: randomUUID(),
      debateMatchId: input.debateMatchId,
      position: 4,
      speakerSlot: 2,
      llmGenerationId: input.judgeGenerationId,
    })
    .run()
  const completion = transaction
    .update(debateMatches)
    .set({ winnerIdeaId: input.winnerIdeaId, completedAt: new Date() })
    .where(
      and(
        eq(debateMatches.debateMatchId, input.debateMatchId),
        isNull(debateMatches.winnerIdeaId),
      ),
    )
    .run()
  if (completion.changes !== 1) {
    throw new Error("Debate match was already completed")
  }
}
