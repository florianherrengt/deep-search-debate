import { asc, eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  debateJobs,
  ideas as ideaRecords,
} from "../../db/schema/index.ts"
import { collectStreamText } from "../../helpers/collectStreamText.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  generateObjectStream,
  generateTextStream,
} from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  buildJudgePrompt,
  buildOpeningPrompt,
  buildRebuttalPrompt,
  loadDebateContext,
  type DebateCandidate,
  type DebateContext,
} from "./context.ts"
import {
  completeDebateMatch,
  createAgentMessage,
  createDebateRound,
  type DebateRoundStage,
} from "./persistence.ts"
import {
  judgeVerdictSchema,
  type LiveDebateJob,
} from "./schemas.ts"
import {
  createFinalRound,
  createNextSwissRound,
  createSemifinalRound,
  DEBATE_TOURNAMENT_FORMAT,
  deriveSwissStandings,
  type CompletedSwissRound,
  type DebateMatchResult,
  type DebatePairing,
  type TournamentIdea,
} from "./tournament.ts"

type RunDebateJobInput = {
  debateJobId: string
  ideaJobId: string
  randomSeed: number
  ideaCompletion: Promise<void>
  job: LiveDebateJob
}

type PersistedDebateIdea = DebateCandidate & TournamentIdea

type CreatedMatch = {
  debateMatchId: string
  firstIdeaId: string
  secondIdeaId: string
}

async function settleAll<Result>(
  promises: readonly Promise<Result>[],
): Promise<Result[]> {
  const settled = await Promise.allSettled(promises)
  const failure = settled.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  )
  if (failure) throw failure.reason
  return settled.map(
    (result) => (result as PromiseFulfilledResult<Result>).value,
  )
}

function setStage(
  debateJobId: string,
  stage: "swiss" | "semifinal" | "final",
): void {
  db.update(debateJobs)
    .set({ stage })
    .where(eq(debateJobs.debateJobId, debateJobId))
    .run()
}

function loadIdeas(ideaJobId: string): PersistedDebateIdea[] {
  return db
    .select({
      ideaId: ideaRecords.ideaId,
      position: ideaRecords.position,
      title: ideaRecords.title,
      description: ideaRecords.description,
    })
    .from(ideaRecords)
    .where(eq(ideaRecords.ideaJobId, ideaJobId))
    .orderBy(asc(ideaRecords.position))
    .all()
}

async function runAgentMessage(input: {
  match: CreatedMatch
  position: 0 | 1 | 2 | 3
  speakerSlot: 0 | 1
  promptName: typeof PromptName.DebateOpening | typeof PromptName.DebateRebuttal
  prompt: string
  job: LiveDebateJob
}): Promise<string> {
  const generation = await generateTextStream({
    prompt: input.prompt,
    promptName: input.promptName,
    maxRetries: 0,
  })
  createAgentMessage({
    debateMatchId: input.match.debateMatchId,
    position: input.position,
    speakerSlot: input.speakerSlot,
    llmGenerationId: generation.id,
  })
  input.job.publish({ type: "updated" })
  const text = await collectStreamText(generation)
  if (!text.trim()) {
    throw new Error("Debate advocate returned an empty message")
  }
  return text
}

async function runMatch(input: {
  match: CreatedMatch
  ideasById: ReadonlyMap<string, DebateCandidate>
  context: DebateContext
  job: LiveDebateJob
}): Promise<DebateMatchResult> {
  const first = input.ideasById.get(input.match.firstIdeaId)
  const second = input.ideasById.get(input.match.secondIdeaId)
  if (!first || !second) {
    throw new Error("Debate match contains an unknown idea")
  }

  const [firstOpening, secondOpening] = await settleAll([
    runAgentMessage({
      match: input.match,
      position: 0,
      speakerSlot: 0,
      promptName: PromptName.DebateOpening,
      prompt: buildOpeningPrompt(input.context, first, second),
      job: input.job,
    }),
    runAgentMessage({
      match: input.match,
      position: 1,
      speakerSlot: 1,
      promptName: PromptName.DebateOpening,
      prompt: buildOpeningPrompt(input.context, second, first),
      job: input.job,
    }),
  ])

  const [firstRebuttal, secondRebuttal] = await settleAll([
    runAgentMessage({
      match: input.match,
      position: 2,
      speakerSlot: 0,
      promptName: PromptName.DebateRebuttal,
      prompt: buildRebuttalPrompt(
        input.context,
        first,
        second,
        firstOpening,
        secondOpening,
      ),
      job: input.job,
    }),
    runAgentMessage({
      match: input.match,
      position: 3,
      speakerSlot: 1,
      promptName: PromptName.DebateRebuttal,
      prompt: buildRebuttalPrompt(
        input.context,
        second,
        first,
        secondOpening,
        firstOpening,
      ),
      job: input.job,
    }),
  ])

  const judge = await generateObjectStream({
    prompt: buildJudgePrompt(input.context, first, second, [
      firstOpening,
      secondOpening,
      firstRebuttal,
      secondRebuttal,
    ]),
    promptName: PromptName.DebateJudge,
    schema: judgeVerdictSchema,
    maxRetries: 0,
    onCompleted: ({ id, output }, transaction) => {
      completeDebateMatch(
        {
          debateMatchId: input.match.debateMatchId,
          winnerIdeaId:
            output.winnerSlot === 0 ? first.ideaId : second.ideaId,
          judgeGenerationId: id,
        },
        transaction,
      )
    },
  })
  const [verdictResult, streamResult] = await Promise.allSettled([
    judge.output,
    collectStreamText(judge),
  ])
  if (verdictResult.status === "rejected") throw verdictResult.reason
  if (streamResult.status === "rejected") throw streamResult.reason
  const verdict = verdictResult.value
  const winnerIdeaId =
    verdict.winnerSlot === 0 ? first.ideaId : second.ideaId

  input.job.publish({ type: "updated" })

  return {
    firstIdeaId: first.ideaId,
    secondIdeaId: second.ideaId,
    winnerIdeaId,
  }
}

async function runRound(input: {
  debateJobId: string
  stage: DebateRoundStage
  stageRoundNumber: number
  pairings: readonly DebatePairing[]
  ideasById: ReadonlyMap<string, DebateCandidate>
  context: DebateContext
  job: LiveDebateJob
}): Promise<DebateMatchResult[]> {
  const matches = createDebateRound({
    debateJobId: input.debateJobId,
    stage: input.stage,
    stageRoundNumber: input.stageRoundNumber,
    pairs: input.pairings.map(
      ({ firstIdeaId, secondIdeaId }) =>
        [firstIdeaId, secondIdeaId] as const,
    ),
  })
  input.job.publish({ type: "updated" })

  // Launch every match before awaiting any one result. Each match applies the
  // same rule to both advocate calls in its opening and rebuttal phases.
  return settleAll(
    matches.map((match) =>
      runMatch({
        match,
        ideasById: input.ideasById,
        context: input.context,
        job: input.job,
      }),
    ),
  )
}

async function executeTournament(input: RunDebateJobInput): Promise<void> {
  await input.ideaCompletion

  const ideas = loadIdeas(input.ideaJobId)
  const context = loadDebateContext(input.ideaJobId)
  // Tournament position is pairing metadata, not evidence. Project candidates
  // before serialization so advocates and judges cannot infer generation order.
  const ideasById = new Map(
    ideas.map(({ ideaId, title, description }) => [
      ideaId,
      { ideaId, title, description },
    ]),
  )
  const tournamentIdeas: TournamentIdea[] = ideas.map(
    ({ ideaId, position }) => ({ ideaId, position }),
  )
  const completedSwissRounds: CompletedSwissRound[] = []

  setStage(input.debateJobId, "swiss")
  input.job.publish({ type: "updated" })
  for (
    let roundNumber = 1;
    roundNumber <= DEBATE_TOURNAMENT_FORMAT.swissRounds;
    roundNumber += 1
  ) {
    const pairings = createNextSwissRound({
      ideas: tournamentIdeas,
      completedRounds: completedSwissRounds,
      randomSeed: input.randomSeed,
    })
    const results = await runRound({
      debateJobId: input.debateJobId,
      stage: "swiss",
      stageRoundNumber: roundNumber,
      pairings,
      ideasById,
      context,
      job: input.job,
    })
    completedSwissRounds.push(results)
  }

  const standings = deriveSwissStandings(
    tournamentIdeas,
    completedSwissRounds,
    input.randomSeed,
  )
  setStage(input.debateJobId, "semifinal")
  input.job.publish({ type: "updated" })
  const semifinalResults = await runRound({
    debateJobId: input.debateJobId,
    stage: "semifinal",
    stageRoundNumber: 1,
    pairings: createSemifinalRound(standings, input.randomSeed),
    ideasById,
    context,
    job: input.job,
  })

  setStage(input.debateJobId, "final")
  input.job.publish({ type: "updated" })
  await runRound({
    debateJobId: input.debateJobId,
    stage: "final",
    stageRoundNumber: 1,
    pairings: [createFinalRound(semifinalResults, input.randomSeed)],
    ideasById,
    context,
    job: input.job,
  })

  db.update(debateJobs)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(debateJobs.debateJobId, input.debateJobId))
    .run()
  input.job.publish({ type: "updated" })
}

/** Runs one all-or-nothing automatic tournament without retrying model calls. */
export async function runDebateJob(input: RunDebateJobInput): Promise<void> {
  try {
    await executeTournament(input)
  } catch (error) {
    const message = getErrorMessage(error, "Debate tournament failed")
    try {
      db.update(debateJobs)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
        })
        .where(eq(debateJobs.debateJobId, input.debateJobId))
        .run()
    } catch (persistenceError) {
      console.error(
        `Failed to persist debate job ${input.debateJobId} failure`,
        persistenceError,
      )
    }
    input.job.publish({ type: "error", message })
  } finally {
    input.job.publish({ type: "done" })
    input.job.close()
  }
}
