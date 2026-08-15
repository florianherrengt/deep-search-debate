import { and, asc, eq, inArray } from "drizzle-orm"

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
import { judgeVerdictSchema } from "./schemas.ts"
import { debateJobReadScope } from "../readAccess.ts"
import {
  deriveSwissStandings,
  getMatchesPerSwissRound,
  getTotalMatchCount,
  type CompletedSwissRound,
} from "./tournament.ts"

type DebateIdeaSnapshot = {
  ideaId: string
  position: number
  title: string
  description: string
}

type DebateMessageSnapshot = {
  debateMessageId: string
  position: number
  speakerSlot: 0 | 1 | 2
  llmGenerationId: string
  text: string
  createdAt: Date
}

type DebateMatchSnapshot = {
  debateMatchId: string
  position: number
  firstIdea: DebateIdeaSnapshot
  secondIdea: DebateIdeaSnapshot
  winnerIdeaId: string | null
  status: "pending" | "running" | "completed"
  messages: DebateMessageSnapshot[]
}

type DebateRoundSnapshot = {
  debateRoundId: string
  stage: "swiss" | "semifinal" | "final"
  stageRoundNumber: number
  matches: DebateMatchSnapshot[]
}

export type DebateJobSnapshot = {
  debateJobId: string
  ideaJobId: string
  title: string
  slug: string
  prompt: string
  isPublic: boolean
  isOwner: boolean
  stopRequested: boolean
  canStop: boolean
  stage: "ideas" | "swiss" | "semifinal" | "final"
  status: "running" | "completed" | "failed" | "interrupted"
  expectedMatchCount: number | null
  rounds: DebateRoundSnapshot[]
  standings: { idea: DebateIdeaSnapshot; wins: number; elo: number }[]
  error: string | null
}

const stageOrder = { swiss: 0, semifinal: 1, final: 2 } as const

function parseMessageText(speakerSlot: number, rawText: string | null): string {
  if (speakerSlot !== 2 || rawText === null) return rawText ?? ""

  try {
    return judgeVerdictSchema.parse(JSON.parse(rawText) as unknown).explanation
  } catch (error) {
    throw new Error("A persisted judge verdict is not valid structured output", {
      cause: error,
    })
  }
}

/** Rebuilds the complete UI projection from durable tournament facts. */
export function getDebateJobSnapshot(
  debateJobId: string,
  viewerUserId: string | null,
): DebateJobSnapshot | undefined {
  const job = db
    .select({
      debateJobId: debateJobs.debateJobId,
      ideaJobId: ideaJobs.ideaJobId,
      randomSeed: debateJobs.randomSeed,
      isPublic: debateJobs.isPublic,
      stage: debateJobs.stage,
      status: debateJobs.status,
      error: debateJobs.error,
      cancelRequestedAt: debateJobs.cancelRequestedAt,
      title: ideaJobs.title,
      slug: ideaJobs.slug,
      prompt: ideaJobs.prompt,
      selectionGenerationId: ideaJobs.selectionGenerationId,
      userId: debateJobs.userId,
    })
    .from(debateJobs)
    .innerJoin(ideaJobs, eq(debateJobs.debateJobId, ideaJobs.debateJobId))
    .where(
      and(
        eq(debateJobs.debateJobId, debateJobId),
        debateJobReadScope(viewerUserId),
      ),
    )
    .get()
  if (!job) return

  const persistedIdeaRows = db
    .select({
      ideaId: ideas.ideaId,
      position: ideas.position,
      title: ideas.title,
      description: ideas.description,
      refinedTitle: ideas.refinedTitle,
      refinedDescription: ideas.refinedDescription,
      selected: ideas.selected,
    })
    .from(ideas)
    .where(eq(ideas.ideaJobId, job.ideaJobId))
    .orderBy(asc(ideas.position))
    .all()
  const ideaRows: DebateIdeaSnapshot[] = persistedIdeaRows
    .filter((idea) =>
      job.selectionGenerationId
        ? idea.selected === true
        : job.stage !== "ideas",
    )
    .map(
      ({
        selected: _selected,
        refinedTitle,
        refinedDescription,
        ...idea
      }) => ({
        ...idea,
        title: refinedTitle ?? idea.title,
        description: refinedDescription ?? idea.description,
      }),
    )
  const ideasById = new Map(ideaRows.map((idea) => [idea.ideaId, idea]))

  const roundRows = db
    .select()
    .from(debateRounds)
    .where(eq(debateRounds.debateJobId, debateJobId))
    .all()
    .sort(
      (first, second) =>
        stageOrder[first.stage] - stageOrder[second.stage] ||
        first.stageRoundNumber - second.stageRoundNumber,
    )
  const roundIds = roundRows.map(({ debateRoundId }) => debateRoundId)
  const matchRows =
    roundIds.length === 0
      ? []
      : db
          .select()
          .from(debateMatches)
          .where(inArray(debateMatches.debateRoundId, roundIds))
          .all()
  const matchIds = matchRows.map(({ debateMatchId }) => debateMatchId)
  const messageRows =
    matchIds.length === 0
      ? []
      : db
          .select({
            debateMessageId: debateMessages.debateMessageId,
            debateMatchId: debateMessages.debateMatchId,
            position: debateMessages.position,
            speakerSlot: debateMessages.speakerSlot,
            llmGenerationId: debateMessages.llmGenerationId,
            createdAt: debateMessages.createdAt,
            text: llmGenerations.text,
          })
          .from(debateMessages)
          .innerJoin(
            llmGenerations,
            eq(
              debateMessages.llmGenerationId,
              llmGenerations.llmGenerationId,
            ),
          )
          .where(inArray(debateMessages.debateMatchId, matchIds))
          .all()

  const messagesByMatch = new Map<string, DebateMessageSnapshot[]>()
  for (const message of messageRows) {
    if (
      message.speakerSlot !== 0 &&
      message.speakerSlot !== 1 &&
      message.speakerSlot !== 2
    ) {
      throw new Error(`Debate message ${message.debateMessageId} has an invalid speaker`)
    }
    const messages = messagesByMatch.get(message.debateMatchId) ?? []
    messages.push({
      debateMessageId: message.debateMessageId,
      position: message.position,
      speakerSlot: message.speakerSlot,
      llmGenerationId: message.llmGenerationId,
      text: parseMessageText(message.speakerSlot, message.text),
      createdAt: message.createdAt,
    })
    messagesByMatch.set(message.debateMatchId, messages)
  }
  for (const messages of messagesByMatch.values()) {
    messages.sort((first, second) => first.position - second.position)
  }

  const matchesByRound = new Map<string, DebateMatchSnapshot[]>()
  for (const match of matchRows) {
    const firstIdea = ideasById.get(match.firstIdeaId)
    const secondIdea = ideasById.get(match.secondIdeaId)
    if (!firstIdea || !secondIdea) {
      throw new Error(`Debate match ${match.debateMatchId} contains an idea outside its tournament`)
    }
    const messages = messagesByMatch.get(match.debateMatchId) ?? []
    const matches = matchesByRound.get(match.debateRoundId) ?? []
    matches.push({
      debateMatchId: match.debateMatchId,
      position: match.position,
      firstIdea,
      secondIdea,
      winnerIdeaId: match.winnerIdeaId,
      status: match.winnerIdeaId
        ? "completed"
        : messages.length > 0
          ? "running"
          : "pending",
      messages,
    })
    matchesByRound.set(match.debateRoundId, matches)
  }
  for (const matches of matchesByRound.values()) {
    matches.sort((first, second) => first.position - second.position)
  }

  const rounds: DebateRoundSnapshot[] = roundRows.map((round) => ({
    debateRoundId: round.debateRoundId,
    stage: round.stage,
    stageRoundNumber: round.stageRoundNumber,
    matches: matchesByRound.get(round.debateRoundId) ?? [],
  }))

  const completedSwissRounds: CompletedSwissRound[] = []
  for (const round of rounds.filter(({ stage }) => stage === "swiss")) {
    if (
      round.matches.length !==
        getMatchesPerSwissRound(ideaRows.length) ||
      round.matches.some(({ winnerIdeaId }) => winnerIdeaId === null)
    ) {
      break
    }
    completedSwissRounds.push(
      round.matches.map((match) => ({
        firstIdeaId: match.firstIdea.ideaId,
        secondIdeaId: match.secondIdea.ideaId,
        winnerIdeaId: match.winnerIdeaId as string,
      })),
    )
  }

  const standings =
    ideaRows.length === 0
      ? []
      : deriveSwissStandings(ideaRows, completedSwissRounds, job.randomSeed).map(
          (standing) => ({
            idea: ideasById.get(standing.ideaId) as DebateIdeaSnapshot,
            wins: standing.wins,
            elo: standing.elo,
          }),
        )

  return {
    debateJobId: job.debateJobId,
    ideaJobId: job.ideaJobId,
    title: job.title,
    slug: job.slug,
    prompt: job.prompt,
    isPublic: job.isPublic,
    isOwner: job.userId === viewerUserId,
    stopRequested: job.cancelRequestedAt !== null,
    canStop:
      job.userId === viewerUserId &&
      job.status === "running" &&
      job.cancelRequestedAt === null,
    stage: job.stage,
    status: job.status,
    expectedMatchCount:
      ideaRows.length === 0 ? null : getTotalMatchCount(ideaRows.length),
    rounds,
    standings,
    error: job.error,
  }
}
