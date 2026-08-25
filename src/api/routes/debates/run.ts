import { Effect, Result } from "effect"

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
  loadDebateExecutionSnapshot,
  loadDebateMatch,
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
import { generateWinningIdeaSite } from "../ideas/ideaSites.ts"
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
  ideaJobManager: {
    resumeExisting(
      ideaJobId: string,
      options: { workflowSignal?: AbortSignal },
    ): { completion: Promise<void> }
  }
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

function loadIdeas(debateJobId: string): PersistedDebateIdea[] {
  const execution = loadDebateExecutionSnapshot(debateJobId)
  if (!execution) throw new Error("Debate job was not found")
  const rows = execution.selectedIdeas.map((idea) => ({
    ideaId: idea.ideaId,
    position: idea.position,
    title: idea.refinedTitle,
    description: idea.refinedDescription,
  }))
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
  const persistedMatch = loadDebateMatch(input.match.debateMatchId)
  if (!persistedMatch) throw new Error("Debate match was not found")
  const persistedMessage = persistedMatch.messages.find(
    ({ position }) => position === input.position,
  )
  if (
    persistedMessage &&
    persistedMessage.speakerSlot !== input.speakerSlot
  ) {
    throw new Error("Persisted debate message has the wrong speaker")
  }
  if (persistedMessage?.generation.status === "completed") {
    const text = persistedMessage.generation.text
    if (!text?.trim()) {
      throw new Error("Completed debate advocate has no message text")
    }
    return text
  }
  let linkedGenerationId = persistedMessage?.generation.generationId
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

async function runJudge(input: {
  userId: string
  debateJobId: string
  match: CreatedMatch
  first: DebateCandidate
  second: DebateCandidate
  firstResearch: DebateCandidateResearch
  secondResearch: DebateCandidateResearch
  context: DebateContext
  transcript: readonly [string, string, string, string]
  job: LiveDebateJob
  workflowSignal?: AbortSignal
}): Promise<DebateMatchResult> {
  const persistedMatch = loadDebateMatch(input.match.debateMatchId)
  if (!persistedMatch) throw new Error("Debate match was not found")
  const persistedJudge = persistedMatch.messages.find(
    ({ position }) => position === 4,
  )
  if (persistedJudge && persistedJudge.speakerSlot !== 2) {
    throw new Error("Persisted judge message has the wrong speaker")
  }
  if (persistedMatch.winnerIdeaId !== null) {
    if (persistedJudge?.generation.status !== "completed") {
      throw new Error("Completed debate match has no completed judge verdict")
    }
    return {
      firstIdeaId: persistedMatch.firstIdeaId,
      secondIdeaId: persistedMatch.secondIdeaId,
      winnerIdeaId: persistedMatch.winnerIdeaId,
    }
  }
  if (persistedJudge?.generation.status === "completed") {
    throw new Error("Completed judge generation has no durable match result")
  }
  let linkedGenerationId = persistedJudge?.generation.generationId
  const verdict = await retryOtherFinish(
    async () => {
      const failedGenerationId = linkedGenerationId
      const generation = await generateObjectStream({
        userId: input.userId,
        owner: { debateJobId: input.debateJobId },
        prompt: buildJudgePrompt(
          input.context,
          input.first,
          input.second,
          input.firstResearch,
          input.secondResearch,
          [...input.transcript],
        ),
        promptName: PromptName.DebateJudge,
        schema: judgeVerdictSchema,
        maxOutputTokens: 1_024,
        workflowSignal: input.workflowSignal,
        onRegistered: (generationId, transaction) => {
          if (failedGenerationId === undefined) {
            createAgentMessage(
              {
                debateMatchId: input.match.debateMatchId,
                position: 4,
                speakerSlot: 2,
                llmGenerationId: generationId,
              },
              transaction,
            )
          } else {
            replaceFailedAgentMessageGeneration(
              {
                debateMatchId: input.match.debateMatchId,
                position: 4,
                failedGenerationId,
                retryGenerationId: generationId,
              },
              transaction,
            )
          }
        },
        onCompleted: ({ id, output }, transaction) => {
          completeDebateMatch(
            {
              debateMatchId: input.match.debateMatchId,
              winnerIdeaId:
                output.winner === "candidate_a"
                  ? input.first.ideaId
                  : input.second.ideaId,
              judgeGenerationId: id,
            },
            transaction,
          )
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
    (generation) => awaitGenerationOutput(generation, generation.output),
  )
  return {
    firstIdeaId: input.first.ideaId,
    secondIdeaId: input.second.ideaId,
    winnerIdeaId:
      verdict.winner === "candidate_a"
        ? input.first.ideaId
        : input.second.ideaId,
  }
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
    const result = yield* workflowEffect(() =>
      runJudge({
        userId: input.userId,
        debateJobId: input.debateJobId,
        match: input.match,
        first,
        second,
        firstResearch,
        secondResearch,
        context: input.context,
        transcript: [
          firstOpening,
          secondOpening,
          firstRebuttal,
          secondRebuttal,
        ],
        job: input.job,
        workflowSignal: input.workflowSignal,
      }),
    )
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    return result
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
    const initialExecution = yield* workflowEffect(() => {
      const execution = loadDebateExecutionSnapshot(input.debateJobId)
      if (!execution) throw new Error("Debate job was not found")
      return execution
    })
    const ideaJob = yield* workflowEffect(
      () =>
        input.ideaJobManager.resumeExisting(
          initialExecution.ideaJob.ideaJobId,
          { workflowSignal: input.workflowSignal },
        ),
      "Debate idea pipeline failed",
    )
    yield* workflowEffect(
      () => ideaJob.completion,
      "Debate idea pipeline failed",
    )

    const execution = yield* workflowEffect(() => {
      const persisted = loadDebateExecutionSnapshot(input.debateJobId)
      if (!persisted) throw new Error("Debate job was not found")
      if (persisted.ideaJob.status !== "completed") {
        throw new Error(
          persisted.ideaJob.error ?? "Debate idea pipeline did not complete",
        )
      }
      return persisted
    })
    const userId = execution.debate.userId
    const ideaJobId = execution.ideaJob.ideaJobId
    const randomSeed = execution.debate.randomSeed

    const ideas = yield* workflowEffect(() => loadIdeas(input.debateJobId))
    const context = yield* workflowEffect(() => loadDebateContext(ideaJobId))
    const researchByIdeaId = yield* workflowEffect(() =>
      loadDebateCandidateResearch(ideaJobId),
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
        randomSeed,
      })
      const results = yield* runRoundEffect({
        userId,
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
      randomSeed,
    )
    yield* workflowEffect(() =>
      setDebateJobStage(input.debateJobId, "semifinal"),
    )
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    const semifinalResults = yield* runRoundEffect({
      userId,
      debateJobId: input.debateJobId,
      stage: "semifinal",
      stageRoundNumber: 1,
      pairings: createSemifinalRound(standings, randomSeed),
      ideasById,
      researchByIdeaId,
      context,
      job: input.job,
      workflowSignal: input.workflowSignal,
    })

    yield* workflowEffect(() => setDebateJobStage(input.debateJobId, "final"))
    yield* workflowEffect(() => input.job.publish({ type: "updated" }))
    const finalResults = yield* runRoundEffect({
      userId,
      debateJobId: input.debateJobId,
      stage: "final",
      stageRoundNumber: 1,
      pairings: [createFinalRound(semifinalResults, randomSeed)],
      ideasById,
      researchByIdeaId,
      context,
      job: input.job,
      workflowSignal: input.workflowSignal,
    })
    const winnerIdeaId = finalResults[0]?.winnerIdeaId
    if (winnerIdeaId === undefined) {
      return yield* Effect.fail(
        new WorkflowFailure({ message: "The final match produced no winner" }),
      )
    }

    // The champion's website is part of the deliverable: its generation is
    // debate-owned, fatal on failure, and must settle before completion.
    yield* workflowEffect(
      () =>
        generateWinningIdeaSite({
          userId,
          debateJobId: input.debateJobId,
          winnerIdeaId,
          workflowSignal: input.workflowSignal,
        }),
      "Winning idea website failed",
    )

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
