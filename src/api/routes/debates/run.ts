import { and, asc, eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import { debateJobs, ideas as ideaRecords } from "../../db/schema/index.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  generateObjectStream,
  generateTextStream,
} from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  awaitGenerationText,
  type GenerationHandle,
} from "../../llms/streams.ts"
import {
  buildJudgePrompt,
  buildOpeningPrompt,
  buildRebuttalPrompt,
  loadDebateCandidateResearch,
  loadDebateContext,
  type DebateCandidate,
  type DebateCandidateResearch,
  type DebateContext,
} from "./context.ts"
import {
  completeDebateMatch,
  createAgentMessage,
  createDebateRound,
  replaceFailedAgentMessageGeneration,
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
  userId: string
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

// `other` collapses unknown provider finish reasons, so this remains a
// debate-local one-shot heuristic rather than a general retry policy.
const MAX_OTHER_FINISH_ATTEMPTS = 2

async function retryOtherFinish<Result, Generation extends GenerationHandle>(
  start: () => Promise<Generation>,
  read: (generation: Generation) => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    const generation = await start()
    try {
      return await read(generation)
    } catch (error) {
      const outcome = await generation.completion.catch(() => undefined)
      if (
        attempt >= MAX_OTHER_FINISH_ATTEMPTS ||
        outcome?.status !== "failed" ||
        outcome.failureKind !== "finish-reason" ||
        outcome.finishReason !== "other"
      ) {
        throw error
      }
    }
  }
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
  const rows = db
    .select({
      ideaId: ideaRecords.ideaId,
      position: ideaRecords.position,
      title: ideaRecords.refinedTitle,
      description: ideaRecords.refinedDescription,
    })
    .from(ideaRecords)
    .where(
      and(
        eq(ideaRecords.ideaJobId, ideaJobId),
        eq(ideaRecords.selected, true),
      ),
    )
    .orderBy(asc(ideaRecords.position))
    .all()
  if (rows.some(({ title, description }) => !title || !description)) {
    throw new Error("Selected ideas were not refined")
  }
  return rows.map(({ ideaId, position, title, description }) => ({
    ideaId,
    position,
    title: title!,
    description: description!,
  }))
}

async function runAgentMessage(input: {
  userId: string
  debateJobId: string
  match: CreatedMatch
  position: 0 | 1 | 2 | 3
  speakerSlot: 0 | 1
  promptName: typeof PromptName.DebateOpening | typeof PromptName.DebateRebuttal
  prompt: string
  job: LiveDebateJob
}): Promise<string> {
  let linkedGenerationId: string | undefined
  const text = await retryOtherFinish(
    async () => {
      const failedGenerationId = linkedGenerationId
      const generation = await generateTextStream({
        userId: input.userId,
        owner: { debateJobId: input.debateJobId },
        prompt: input.prompt,
        promptName: input.promptName,
        reasoning: "disabled",
        maxOutputTokens: 2_048,
        onRegistered: (generationId, transaction) => {
          if (failedGenerationId === undefined) {
            createAgentMessage(
              {
                debateMatchId: input.match.debateMatchId,
                position: input.position,
                speakerSlot: input.speakerSlot,
                llmGenerationId: generationId,
              },
              transaction,
            )
          } else {
            replaceFailedAgentMessageGeneration(
              {
                debateMatchId: input.match.debateMatchId,
                position: input.position,
                failedGenerationId,
                retryGenerationId: generationId,
              },
              transaction,
            )
          }
        },
      })
      linkedGenerationId = generation.id
      try {
        input.job.publish({ type: "updated" })
      } catch (error) {
        await generation.completion.catch(() => undefined)
        throw error
      }
      return generation
    },
    awaitGenerationText,
  )
  if (!text.trim()) {
    throw new Error("Debate advocate returned an empty message")
  }
  return text
}

async function runMatch(input: {
  userId: string
  debateJobId: string
  match: CreatedMatch
  ideasById: ReadonlyMap<string, DebateCandidate>
  researchByIdeaId: ReadonlyMap<string, DebateCandidateResearch>
  context: DebateContext
  job: LiveDebateJob
}): Promise<DebateMatchResult> {
  const first = input.ideasById.get(input.match.firstIdeaId)
  const second = input.ideasById.get(input.match.secondIdeaId)
  if (!first || !second) {
    throw new Error("Debate match contains an unknown idea")
  }
  const firstResearch = input.researchByIdeaId.get(first.ideaId)
  const secondResearch = input.researchByIdeaId.get(second.ideaId)
  if (!firstResearch || !secondResearch) {
    throw new Error("Debate candidate research was not found")
  }

  const [firstOpening, secondOpening] = await settleAll([
    runAgentMessage({
      userId: input.userId,
      debateJobId: input.debateJobId,
      match: input.match,
      position: 0,
      speakerSlot: 0,
      promptName: PromptName.DebateOpening,
      prompt: buildOpeningPrompt(
        input.context,
        first,
        second,
        firstResearch,
      ),
      job: input.job,
    }),
    runAgentMessage({
      userId: input.userId,
      debateJobId: input.debateJobId,
      match: input.match,
      position: 1,
      speakerSlot: 1,
      promptName: PromptName.DebateOpening,
      prompt: buildOpeningPrompt(
        input.context,
        second,
        first,
        secondResearch,
      ),
      job: input.job,
    }),
  ])

  const [firstRebuttal, secondRebuttal] = await settleAll([
    runAgentMessage({
      userId: input.userId,
      debateJobId: input.debateJobId,
      match: input.match,
      position: 2,
      speakerSlot: 0,
      promptName: PromptName.DebateRebuttal,
      prompt: buildRebuttalPrompt(
        input.context,
        first,
        second,
        firstResearch,
        firstOpening,
        secondOpening,
      ),
      job: input.job,
    }),
    runAgentMessage({
      userId: input.userId,
      debateJobId: input.debateJobId,
      match: input.match,
      position: 3,
      speakerSlot: 1,
      promptName: PromptName.DebateRebuttal,
      prompt: buildRebuttalPrompt(
        input.context,
        second,
        first,
        secondResearch,
        secondOpening,
        firstOpening,
      ),
      job: input.job,
    }),
  ])

  const verdict = await retryOtherFinish(
    () =>
      generateObjectStream({
        userId: input.userId,
        owner: { debateJobId: input.debateJobId },
        prompt: buildJudgePrompt(
          input.context,
          first,
          second,
          firstResearch,
          secondResearch,
          [
            firstOpening,
            secondOpening,
            firstRebuttal,
            secondRebuttal,
          ],
        ),
        promptName: PromptName.DebateJudge,
        schema: judgeVerdictSchema,
        maxOutputTokens: 1_024,
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
      }),
    (generation) =>
      awaitGenerationOutput(generation, generation.output),
  )
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
  userId: string
  debateJobId: string
  stage: DebateRoundStage
  stageRoundNumber: number
  pairings: readonly DebatePairing[]
  ideasById: ReadonlyMap<string, DebateCandidate>
  researchByIdeaId: ReadonlyMap<string, DebateCandidateResearch>
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
        userId: input.userId,
        debateJobId: input.debateJobId,
        match,
        ideasById: input.ideasById,
        researchByIdeaId: input.researchByIdeaId,
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
  const researchByIdeaId = loadDebateCandidateResearch(input.ideaJobId)
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
  if (researchByIdeaId.size !== ideas.length) {
    throw new Error("Every selected idea must have completed research")
  }
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
      userId: input.userId,
      debateJobId: input.debateJobId,
      stage: "swiss",
      stageRoundNumber: roundNumber,
      pairings,
      ideasById,
      researchByIdeaId,
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
    userId: input.userId,
    debateJobId: input.debateJobId,
    stage: "semifinal",
    stageRoundNumber: 1,
    pairings: createSemifinalRound(standings, input.randomSeed),
    ideasById,
    researchByIdeaId,
    context,
    job: input.job,
  })

  setStage(input.debateJobId, "final")
  input.job.publish({ type: "updated" })
  await runRound({
    userId: input.userId,
    debateJobId: input.debateJobId,
    stage: "final",
    stageRoundNumber: 1,
    pairings: [createFinalRound(semifinalResults, input.randomSeed)],
    ideasById,
    researchByIdeaId,
    context,
    job: input.job,
  })

  db.update(debateJobs)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(debateJobs.debateJobId, input.debateJobId))
    .run()
  input.job.publish({ type: "updated" })
}

/** Runs one all-or-nothing tournament with one bounded retry for `other`. */
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
