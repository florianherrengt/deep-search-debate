import { and, asc, eq } from "drizzle-orm"
import { Effect, Result } from "effect"

import { db } from "../../db/index.ts"
import { ideas as ideaRecords } from "../../db/schema/index.ts"
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
  getWorkflowStopReason,
  runWorkflowEffect,
  WorkflowFailure,
  WorkflowInterruptedError,
} from "../../workflowRuntime.ts"
import { EffectiveResearchRootInactiveError } from "../researchCancellation.ts"
import {
  completeDebateJob,
  failDebateJob,
  interruptDebateJob,
  setDebateJobStage,
} from "./jobLifecycle.ts"
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
  workflowSignal?: AbortSignal
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

function workflowEffect<Value>(
  run: () => Value | PromiseLike<Value>,
  fallback = "Debate workflow work failed",
): Effect.Effect<Value, WorkflowFailure> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve().then(run),
      catch: (cause) =>
        cause instanceof WorkflowFailure
          ? cause
          : new WorkflowFailure({
              message: getErrorMessage(cause, fallback),
              cause,
            }),
    }),
  )
}

function settleAllEffects<Value>(
  effects: readonly Effect.Effect<Value, WorkflowFailure>[],
): Effect.Effect<Value[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* Effect.all(effects, {
      concurrency: "unbounded",
      mode: "result",
    })
    const values: Value[] = []
    for (const result of settled) {
      if (Result.isFailure(result)) {
        return yield* Effect.fail(result.failure)
      }
      values.push(result.success)
    }
    return values
  })
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
  workflowSignal?: AbortSignal
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
        workflowSignal: input.workflowSignal,
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

function runMatchEffect(input: {
  userId: string
  debateJobId: string
  match: CreatedMatch
  ideasById: ReadonlyMap<string, DebateCandidate>
  researchByIdeaId: ReadonlyMap<string, DebateCandidateResearch>
  context: DebateContext
  job: LiveDebateJob
  workflowSignal?: AbortSignal
}): Effect.Effect<DebateMatchResult, WorkflowFailure> {
  return Effect.gen(function*() {
    const first = input.ideasById.get(input.match.firstIdeaId)
    const second = input.ideasById.get(input.match.secondIdeaId)
    if (!first || !second) {
      return yield* Effect.fail(
        new WorkflowFailure({ message: "Debate match contains an unknown idea" }),
      )
    }
    const firstResearch = input.researchByIdeaId.get(first.ideaId)
    const secondResearch = input.researchByIdeaId.get(second.ideaId)
    if (!firstResearch || !secondResearch) {
      return yield* Effect.fail(
        new WorkflowFailure({ message: "Debate candidate research was not found" }),
      )
    }

    const [firstOpening, secondOpening] = yield* settleAllEffects([
      workflowEffect(() =>
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
          workflowSignal: input.workflowSignal,
        }),
      ),
      workflowEffect(() =>
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
          workflowSignal: input.workflowSignal,
        }),
      ),
    ])
    const [firstRebuttal, secondRebuttal] = yield* settleAllEffects([
      workflowEffect(() =>
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
          workflowSignal: input.workflowSignal,
        }),
      ),
      workflowEffect(() =>
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
          workflowSignal: input.workflowSignal,
        }),
      ),
    ])
    const verdict = yield* workflowEffect(() =>
      retryOtherFinish(
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
            workflowSignal: input.workflowSignal,
            onCompleted: ({ id, output }, transaction) => {
              completeDebateMatch(
                {
                  debateMatchId: input.match.debateMatchId,
                  winnerIdeaId:
                    output.winner === "candidate_a"
                      ? first.ideaId
                      : second.ideaId,
                  judgeGenerationId: id,
                },
                transaction,
              )
            },
          }),
        (generation) =>
          awaitGenerationOutput(generation, generation.output),
      ),
    )
    const winnerIdeaId =
      verdict.winner === "candidate_a" ? first.ideaId : second.ideaId

    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    return {
      firstIdeaId: first.ideaId,
      secondIdeaId: second.ideaId,
      winnerIdeaId,
    }
  })
}

function runRoundEffect(input: {
  userId: string
  debateJobId: string
  stage: DebateRoundStage
  stageRoundNumber: number
  pairings: readonly DebatePairing[]
  ideasById: ReadonlyMap<string, DebateCandidate>
  researchByIdeaId: ReadonlyMap<string, DebateCandidateResearch>
  context: DebateContext
  job: LiveDebateJob
  workflowSignal?: AbortSignal
}): Effect.Effect<DebateMatchResult[], WorkflowFailure> {
  return Effect.gen(function*() {
    const matches = yield* workflowEffect(() =>
      createDebateRound({
        debateJobId: input.debateJobId,
        stage: input.stage,
        stageRoundNumber: input.stageRoundNumber,
        pairs: input.pairings.map(
          ({ firstIdeaId, secondIdeaId }) =>
            [firstIdeaId, secondIdeaId] as const,
        ),
      }),
    )
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))

    // Result mode joins every launched match and unwraps in pairing order.
    return yield* settleAllEffects(
      matches.map((match) =>
        runMatchEffect({
          userId: input.userId,
          debateJobId: input.debateJobId,
          match,
          ideasById: input.ideasById,
          researchByIdeaId: input.researchByIdeaId,
          context: input.context,
          job: input.job,
          workflowSignal: input.workflowSignal,
        }),
      ),
    )
  })
}

function debateTournamentEffect(
  input: RunDebateJobInput,
): Effect.Effect<void, WorkflowFailure> {
  return Effect.gen(function*() {
    yield* workflowEffect(() => input.ideaCompletion, "Debate idea pipeline failed")

    const ideas = yield* workflowEffect(() => loadIdeas(input.ideaJobId))
    const context = yield* workflowEffect(() => loadDebateContext(input.ideaJobId))
    const researchByIdeaId = yield* workflowEffect(() =>
      loadDebateCandidateResearch(input.ideaJobId),
    )
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
      return yield* Effect.fail(
        new WorkflowFailure({
          message: "Every selected idea must have completed research",
        }),
      )
    }
    const completedSwissRounds: CompletedSwissRound[] = []

    yield* workflowEffect(() => setDebateJobStage(input.debateJobId, "swiss"))
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
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
      const results = yield* runRoundEffect({
        userId: input.userId,
        debateJobId: input.debateJobId,
        stage: "swiss",
        stageRoundNumber: roundNumber,
        pairings,
        ideasById,
        researchByIdeaId,
        context,
        job: input.job,
        workflowSignal: input.workflowSignal,
      })
      completedSwissRounds.push(results)
    }

    const standings = deriveSwissStandings(
      tournamentIdeas,
      completedSwissRounds,
      input.randomSeed,
    )
    yield* workflowEffect(() =>
      setDebateJobStage(input.debateJobId, "semifinal"),
    )
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    const semifinalResults = yield* runRoundEffect({
      userId: input.userId,
      debateJobId: input.debateJobId,
      stage: "semifinal",
      stageRoundNumber: 1,
      pairings: createSemifinalRound(standings, input.randomSeed),
      ideasById,
      researchByIdeaId,
      context,
      job: input.job,
      workflowSignal: input.workflowSignal,
    })

    yield* workflowEffect(() => setDebateJobStage(input.debateJobId, "final"))
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    yield* runRoundEffect({
      userId: input.userId,
      debateJobId: input.debateJobId,
      stage: "final",
      stageRoundNumber: 1,
      pairings: [createFinalRound(semifinalResults, input.randomSeed)],
      ideasById,
      researchByIdeaId,
      context,
      job: input.job,
      workflowSignal: input.workflowSignal,
    })

    yield* workflowEffect(() => completeDebateJob(input.debateJobId))
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
  })
}

function getCancellationReason(
  error: unknown,
  signal: AbortSignal | undefined,
): "user-stop" | "parent-stop" | undefined {
  const signalReason = getWorkflowStopReason(signal)
  if (signalReason) return signalReason
  if (error instanceof WorkflowInterruptedError) return error.reason
  if (error instanceof WorkflowFailure && error.cause !== undefined) {
    return getCancellationReason(error.cause, signal)
  }
  if (
    error instanceof EffectiveResearchRootInactiveError &&
    error.reason === "stop-requested"
  ) {
    return error.root?.kind === "debate" ? "user-stop" : "parent-stop"
  }
}

/** Runs the Effect-owned tournament and owns its exact terminal event suffix. */
export async function runDebateJob(input: RunDebateJobInput): Promise<void> {
  try {
    await runWorkflowEffect(debateTournamentEffect(input), input.workflowSignal)
  } catch (error) {
    let cancellationReason = getCancellationReason(error, input.workflowSignal)
    const message = getErrorMessage(error, "Debate tournament failed")
    if (!cancellationReason) {
      try {
        failDebateJob(input.debateJobId, message)
      } catch (persistenceError) {
        cancellationReason = getCancellationReason(
          persistenceError,
          input.workflowSignal,
        )
        if (!cancellationReason) {
          console.error(
            `Failed to persist debate job ${input.debateJobId} failure`,
            persistenceError,
          )
        }
      }
    }
    if (cancellationReason) {
      const interrupted = new WorkflowInterruptedError(cancellationReason)
      interruptDebateJob(input.debateJobId, interrupted.message)
      input.job.publish({ type: "updated" })
      return
    }
    input.job.publish({ type: "error", message })
  } finally {
    input.job.publish({ type: "done" })
    input.job.close()
  }
}
