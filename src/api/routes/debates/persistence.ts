import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"

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

type PersistedDebateGeneration = {
  generationId: string
  status: "running" | "completed" | "failed" | "interrupted"
  text: string | null
  error: string | null
}

type PersistedDebateMessage = {
  debateMessageId: string
  position: number
  speakerSlot: 0 | 1 | 2
  generation: PersistedDebateGeneration
}

export type PersistedDebateMatch = CreatedMatch & {
  winnerIdeaId: string | null
  completedAt: Date | null
  messages: PersistedDebateMessage[]
}

type PersistedDebateRound = {
  debateRoundId: string
  stage: DebateRoundStage
  stageRoundNumber: number
  matches: PersistedDebateMatch[]
}

export type DebateExecutionSnapshot = {
  debate: typeof debateJobs.$inferSelect
  ideaJob: typeof ideaJobs.$inferSelect
  selectedIdeas: (typeof ideas.$inferSelect)[]
  rounds: PersistedDebateRound[]
  websiteGeneration: PersistedDebateGeneration | null
}

const stageOrder = { swiss: 0, semifinal: 1, final: 2 } as const

function toPersistedGeneration(
  generation: typeof llmGenerations.$inferSelect,
): PersistedDebateGeneration {
  return {
    generationId: generation.llmGenerationId,
    status: generation.status,
    text: generation.text,
    error: generation.error,
  }
}

/** Loads the complete durable checkpoint graph for one debate execution. */
export function loadDebateExecutionSnapshot(
  debateJobId: string,
): DebateExecutionSnapshot | undefined {
  const debate = db
    .select()
    .from(debateJobs)
    .where(eq(debateJobs.debateJobId, debateJobId))
    .get()
  if (!debate) return
  const ideaJob = db
    .select()
    .from(ideaJobs)
    .where(eq(ideaJobs.debateJobId, debateJobId))
    .get()
  if (!ideaJob) throw new Error("Debate job has no owned idea job")

  const selectedIdeas = db
    .select()
    .from(ideas)
    .where(
      and(
        eq(ideas.ideaJobId, ideaJob.ideaJobId),
        eq(ideas.selected, true),
      ),
    )
    .orderBy(asc(ideas.position), asc(ideas.ideaId))
    .all()
  const roundRows = db
    .select()
    .from(debateRounds)
    .where(eq(debateRounds.debateJobId, debateJobId))
    .all()
    .sort(
      (first, second) =>
        stageOrder[first.stage] - stageOrder[second.stage] ||
        first.stageRoundNumber - second.stageRoundNumber ||
        first.debateRoundId.localeCompare(second.debateRoundId),
    )
  const roundIds = roundRows.map(({ debateRoundId }) => debateRoundId)
  const matchRows = roundIds.length === 0
    ? []
    : db
        .select()
        .from(debateMatches)
        .where(inArray(debateMatches.debateRoundId, roundIds))
        .orderBy(
          asc(debateMatches.debateRoundId),
          asc(debateMatches.position),
          asc(debateMatches.debateMatchId),
        )
        .all()
  const matchIds = matchRows.map(({ debateMatchId }) => debateMatchId)
  const messageRows = matchIds.length === 0
    ? []
    : db
        .select({
          debateMessageId: debateMessages.debateMessageId,
          debateMatchId: debateMessages.debateMatchId,
          position: debateMessages.position,
          speakerSlot: debateMessages.speakerSlot,
          generation: llmGenerations,
        })
        .from(debateMessages)
        .innerJoin(
          llmGenerations,
          eq(debateMessages.llmGenerationId, llmGenerations.llmGenerationId),
        )
        .where(inArray(debateMessages.debateMatchId, matchIds))
        .orderBy(
          asc(debateMessages.debateMatchId),
          asc(debateMessages.position),
          asc(debateMessages.debateMessageId),
        )
        .all()

  const messagesByMatch = new Map<string, PersistedDebateMessage[]>()
  for (const message of messageRows) {
    if (
      message.speakerSlot !== 0 &&
      message.speakerSlot !== 1 &&
      message.speakerSlot !== 2
    ) {
      throw new Error(
        `Debate message ${message.debateMessageId} has an invalid speaker`,
      )
    }
    const messages = messagesByMatch.get(message.debateMatchId) ?? []
    messages.push({
      debateMessageId: message.debateMessageId,
      position: message.position,
      speakerSlot: message.speakerSlot,
      generation: toPersistedGeneration(message.generation),
    })
    messagesByMatch.set(message.debateMatchId, messages)
  }
  const matchesByRound = new Map<string, PersistedDebateMatch[]>()
  for (const match of matchRows) {
    const matches = matchesByRound.get(match.debateRoundId) ?? []
    matches.push({
      debateMatchId: match.debateMatchId,
      position: match.position,
      firstIdeaId: match.firstIdeaId,
      secondIdeaId: match.secondIdeaId,
      winnerIdeaId: match.winnerIdeaId,
      completedAt: match.completedAt,
      messages: messagesByMatch.get(match.debateMatchId) ?? [],
    })
    matchesByRound.set(match.debateRoundId, matches)
  }

  const websiteGeneration = debate.websiteGenerationId === null
    ? null
    : db
        .select()
        .from(llmGenerations)
        .where(
          eq(
            llmGenerations.llmGenerationId,
            debate.websiteGenerationId,
          ),
        )
        .get()
  if (debate.websiteGenerationId !== null && !websiteGeneration) {
    throw new Error("Linked winner website generation was not found")
  }

  return {
    debate,
    ideaJob,
    selectedIdeas,
    rounds: roundRows.map((round) => ({
      debateRoundId: round.debateRoundId,
      stage: round.stage,
      stageRoundNumber: round.stageRoundNumber,
      matches: matchesByRound.get(round.debateRoundId) ?? [],
    })),
    websiteGeneration: websiteGeneration
      ? toPersistedGeneration(websiteGeneration)
      : null,
  }
}

export function loadDebateMatch(
  debateMatchId: string,
): PersistedDebateMatch | undefined {
  const match = db
    .select({
      debateJobId: debateRounds.debateJobId,
      debateMatchId: debateMatches.debateMatchId,
      position: debateMatches.position,
      firstIdeaId: debateMatches.firstIdeaId,
      secondIdeaId: debateMatches.secondIdeaId,
      winnerIdeaId: debateMatches.winnerIdeaId,
      completedAt: debateMatches.completedAt,
    })
    .from(debateMatches)
    .innerJoin(
      debateRounds,
      eq(debateMatches.debateRoundId, debateRounds.debateRoundId),
    )
    .where(eq(debateMatches.debateMatchId, debateMatchId))
    .get()
  if (!match) return
  const messages = db
    .select({
      debateMessageId: debateMessages.debateMessageId,
      position: debateMessages.position,
      speakerSlot: debateMessages.speakerSlot,
      generation: llmGenerations,
    })
    .from(debateMessages)
    .innerJoin(
      llmGenerations,
      eq(debateMessages.llmGenerationId, llmGenerations.llmGenerationId),
    )
    .where(eq(debateMessages.debateMatchId, debateMatchId))
    .orderBy(asc(debateMessages.position), asc(debateMessages.debateMessageId))
    .all()
    .map((message): PersistedDebateMessage => {
      if (
        message.speakerSlot !== 0 &&
        message.speakerSlot !== 1 &&
        message.speakerSlot !== 2
      ) {
        throw new Error(
          `Debate message ${message.debateMessageId} has an invalid speaker`,
        )
      }
      return {
        debateMessageId: message.debateMessageId,
        position: message.position,
        speakerSlot: message.speakerSlot,
        generation: toPersistedGeneration(message.generation),
      }
    })
  return { ...match, messages }
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
    if (job.status !== "running") {
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

    const existingRound = transaction
      .select({ debateRoundId: debateRounds.debateRoundId })
      .from(debateRounds)
      .where(
        and(
          eq(debateRounds.debateJobId, input.debateJobId),
          eq(debateRounds.stage, input.stage),
          eq(debateRounds.stageRoundNumber, input.stageRoundNumber),
        ),
      )
      .get()
    if (existingRound) {
      const existingMatches = transaction
        .select({
          debateMatchId: debateMatches.debateMatchId,
          position: debateMatches.position,
          firstIdeaId: debateMatches.firstIdeaId,
          secondIdeaId: debateMatches.secondIdeaId,
        })
        .from(debateMatches)
        .where(eq(debateMatches.debateRoundId, existingRound.debateRoundId))
        .orderBy(asc(debateMatches.position), asc(debateMatches.debateMatchId))
        .all()
      const pairingsMatch =
        existingMatches.length === input.pairs.length &&
        existingMatches.every(
          (match, position) =>
            match.position === position &&
            match.firstIdeaId === input.pairs[position]?.[0] &&
            match.secondIdeaId === input.pairs[position]?.[1],
        )
      if (!pairingsMatch) {
        throw new Error(
          `Persisted ${input.stage} round pairings do not match recomputation`,
        )
      }
      return existingMatches
    }

    if (job.stage !== input.stage) {
      throw new Error(`Debate job is not running the ${input.stage} stage`)
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
  speakerSlot: 0 | 1 | 2
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

/** Interrupts a stale attempt and repoints only its exact durable message link. */
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
  assertGenerationOwnedByMatch(
    transaction,
    input.debateMatchId,
    input.failedGenerationId,
  )
  const linkedAttempt = transaction
    .select({ id: debateMessages.debateMessageId })
    .from(debateMessages)
    .where(
      and(
        eq(debateMessages.debateMatchId, input.debateMatchId),
        eq(debateMessages.position, input.position),
        eq(debateMessages.llmGenerationId, input.failedGenerationId),
      ),
    )
    .get()
  if (!linkedAttempt) {
    throw new Error("The failed debate message generation link changed")
  }
  const retryableAttempt = transaction
    .select({ status: llmGenerations.status })
    .from(llmGenerations)
    .where(
      and(
        eq(llmGenerations.llmGenerationId, input.failedGenerationId),
        inArray(llmGenerations.status, [
          "running",
          "failed",
          "interrupted",
        ]),
      ),
    )
    .get()
  if (!retryableAttempt) {
    throw new Error("The replaced generation is not retryable")
  }
  if (retryableAttempt.status === "running") {
    const interruption = transaction
      .update(llmGenerations)
      .set({
        status: "interrupted",
        error: "Interrupted by a server restart",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(llmGenerations.llmGenerationId, input.failedGenerationId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .run()
    if (interruption.changes !== 1) {
      throw new Error("The stale debate generation status changed")
    }
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

/** Commits the durable verdict and machine result in the terminal transaction. */
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
  const currentJudge = transaction
    .select({ llmGenerationId: debateMessages.llmGenerationId })
    .from(debateMessages)
    .where(
      and(
        eq(debateMessages.debateMatchId, input.debateMatchId),
        eq(debateMessages.position, 4),
        eq(debateMessages.speakerSlot, 2),
        eq(debateMessages.llmGenerationId, input.judgeGenerationId),
      ),
    )
    .get()
  if (!currentJudge) {
    throw new Error("The judge generation link changed before completion")
  }
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
