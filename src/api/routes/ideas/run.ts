import { and, eq, isNull } from "drizzle-orm"
import { Effect, Result } from "effect"
import z from "zod"
import { config } from "../../config.ts"
import { ideas as ideaRecords } from "../../db/schema/index.ts"
import {
  allocateFairly,
  formatBoundedTextEntries,
  truncateMiddle,
} from "../../helpers/boundedText.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  generateArrayStream,
  generateObjectStream,
  generateTextStream,
} from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  awaitGenerationText,
  type GenerationHandle,
  type LlmGenerationOwner,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { EffectiveResearchRootInactiveError } from "../researchCancellation.ts"
import { deepSearchResearchRequestSchema } from "../deepSearch/resourceLimits.ts"
import { buildIdeaSitePrompt, writeIdeaSite } from "./ideaSites.ts"
import {
  ideaSchema,
  ideaEvaluationSchema,
  ideaSelectionSchema,
  MAX_SELECTED_IDEAS,
  MIN_SELECTED_IDEAS,
  type Idea,
  type IdeaEvaluation,
  type IdeaEventStage,
  type IdeaJobStage,
  type LiveIdeaJob,
} from "./schemas.ts"
import {
  completeIdeaJob,
  failIdeaJob,
  insertIdeaBatch,
  interruptIdeaJob,
  setIdeaJobGeneration,
  setIdeaJobStage,
  type PersistedIdea,
} from "./jobLifecycle.ts"
import {
  getWorkflowStopReason,
  runWorkflowEffect,
  WorkflowFailure,
  WorkflowInterruptedError,
} from "../../workflowRuntime.ts"

type RunIdeaJobInput = {
  ideaJobId: string
  userId: string
  prompt: string
  numberOfIdeas: number
  deepSearchCount: number
  maxSearches: number
  maxResultsPerSearch: number
  maxRounds?: number
  job: LiveIdeaJob
  deepSearchManager: DeepSearchJobManager
  workflowSignal?: AbortSignal
}

const researchPromptSchema = z.object({
  // The bounded generation response limits memory. Display-length ownership
  // belongs to createPromptIdentity, which normalizes every supplied title.
  title: z.string().trim().min(1),
  prompt: deepSearchResearchRequestSchema,
})
type ResearchPrompt = z.infer<typeof researchPromptSchema>

function buildResearchPrompt(prompt: string, count: number): string {
  return `User request:\n${prompt}\n\nGenerate exactly ${count} deep-search prompts.`
}

function buildSummaryPrompt(prompt: string, research: string[]): string {
  const results = formatBoundedTextEntries(
    research.map((text, index) => ({
      opening: `<research_text index="${index + 1}">\n`,
      text,
      closing: "\n</research_text>",
    })),
    config.deepSearch.maxSummaryContextChars,
  )
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_texts>",
    results,
    "</research_texts>",
  ].join("\n")
}

function buildIdeaPrompt(
  prompt: string,
  researchSummary: string,
  numberOfIdeas: number,
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    `Generate exactly ${numberOfIdeas} ideas.`,
  ].join("\n")
}

function buildEvaluationPrompt(
  prompt: string,
  researchSummary: string,
  idea: RefinedIdea,
  supportingResearch: string,
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    "<improved_idea>",
    JSON.stringify({
      title: idea.refinedTitle,
      description: idea.refinedDescription,
    }),
    "</improved_idea>",
    "<supporting_research>",
    supportingResearch,
    "</supporting_research>",
  ].join("\n")
}

type RefinedIdea = PersistedIdea & {
  refinedTitle: string
  refinedDescription: string
}
type ResearchedRefinedIdea = RefinedIdea & { supportingResearch: string }

const ideaSelectionProposalSchema = z.object({
  // The provider proposes IDs, but the server owns the tournament invariant.
  // Allow a bounded amount of duplicate or invented output so it can be
  // normalized without paying for a retry.
  selectedIdeaIds: z
    .array(z.string().max(64))
    .max(MAX_SELECTED_IDEAS * 2),
})

export function normalizeIdeaSelection(
  proposal: z.infer<typeof ideaSelectionProposalSchema>,
  ideas: ReadonlyArray<{ ideaId: string }>,
): z.infer<typeof ideaSelectionSchema> {
  const orderedIdeaIds = ideas.map(({ ideaId }) => ideaId)
  const knownIdeaIds = new Set(orderedIdeaIds)
  const distinctProposedIdeaIds = new Set(
    proposal.selectedIdeaIds.filter((ideaId) => knownIdeaIds.has(ideaId)),
  )
  const proposedIdeaIds = [...distinctProposedIdeaIds].slice(
    0,
    MAX_SELECTED_IDEAS,
  )
  const fallbackIdeaIds = orderedIdeaIds
    .filter((ideaId) => !proposedIdeaIds.includes(ideaId))
    .slice(0, Math.max(0, MIN_SELECTED_IDEAS - proposedIdeaIds.length))
  const minimumSelection = [...proposedIdeaIds, ...fallbackIdeaIds]
  const nextIdeaId = orderedIdeaIds.find(
    (ideaId) => !minimumSelection.includes(ideaId),
  )
  const selectedIdeaIds =
    minimumSelection.length % 2 === 0
      ? minimumSelection
      : nextIdeaId === undefined
        ? minimumSelection.slice(0, -1)
        : [...minimumSelection, nextIdeaId]

  return ideaSelectionSchema.parse({ selectedIdeaIds })
}

function buildRefinementPrompt(
  prompt: string,
  researchSummary: string,
  idea: PersistedIdea,
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    "<original_idea>",
    JSON.stringify({ title: idea.title, description: idea.description }),
    "</original_idea>",
  ].join("\n")
}

function buildRefinedIdeaResearchRequest(
  prompt: string,
  idea: RefinedIdea,
): string {
  const instruction =
    "Research this proposed idea against the user's request. Investigate evidence, comparable approaches, feasibility, risks, and implementation."
  const fixedParts = [
    instruction,
    "\n<user_request>\n",
    "\n</user_request>\n<refined_idea>{\"title\":",
    ",\"description\":",
    "}</refined_idea>",
  ]
  const fixedChars = fixedParts.join("").length
  const values = [prompt, idea.refinedTitle, idea.refinedDescription]
  const budgets = allocateFairly(
    values.map((value) => JSON.stringify(value).length),
    config.deepSearch.maxRequestChars - fixedChars,
  )
  const serializeWithin = (value: string, maxChars: number): string => {
    let low = 0
    let high = Math.min(value.length, maxChars)
    let fitted = JSON.stringify("")
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = JSON.stringify(truncateMiddle(value, middle))
      if (candidate.length <= maxChars) {
        fitted = candidate
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return fitted
  }
  const serialized = values.map((value, index) =>
    serializeWithin(value, budgets[index]),
  )
  const request = [
    instruction,
    "\n<user_request>\n",
    serialized[0],
    "\n</user_request>\n<refined_idea>{\"title\":",
    serialized[1],
    ",\"description\":",
    serialized[2],
    "}</refined_idea>",
  ].join("")
  return deepSearchResearchRequestSchema.parse(request)
}

function buildSelectionPrompt(
  prompt: string,
  researchSummary: string,
  ideas: PersistedIdea[],
): string {
  const briefing = truncateMiddle(
    researchSummary,
    Math.floor(config.deepSearch.maxSummaryContextChars * 0.2),
  )
  const generatedIdeas = formatBoundedTextEntries(
    ideas.map((idea) => ({
      opening: "<candidate_idea>\n",
      text: JSON.stringify({
        ideaId: idea.ideaId,
        title: idea.title,
        description: idea.description,
      }),
      closing: "\n</candidate_idea>",
    })),
    config.deepSearch.maxSummaryContextChars - briefing.length,
  )
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    briefing,
    "</research_briefing>",
    "<generated_ideas>",
    generatedIdeas,
    "</generated_ideas>",
  ].join("\n")
}

function setGenerationId(
  transaction: TextStreamPersistenceTransaction,
  ideaJobId: string,
  field:
    | "researchPromptGenerationId"
    | "researchSummaryGenerationId"
    | "ideaGenerationId"
    | "selectionGenerationId",
  id: string,
): void {
  setIdeaJobGeneration(transaction, {
    ideaJobId,
    field,
    generationId: id,
  })
}

async function publishStartedGeneration(
  generation: GenerationHandle,
  publish: () => void,
): Promise<void> {
  try {
    publish()
  } catch (error) {
    await generation.completion.catch(() => undefined)
    throw error
  }
}

function workflowEffect<Value>(
  run: () => Value | PromiseLike<Value>,
  fallback = "Idea workflow work failed",
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

function settleEffects<Value>(
  effects: readonly Effect.Effect<Value, WorkflowFailure>[],
) {
  return Effect.all(effects, {
    concurrency: "unbounded",
    mode: "result",
  })
}

function unwrapSettled<Value>(
  settled: readonly Result.Result<Value, WorkflowFailure>[],
): Effect.Effect<Value[], WorkflowFailure> {
  return Effect.gen(function*() {
    const firstFailure = settled.find(Result.isFailure)
    if (firstFailure) yield* Effect.fail(firstFailure.failure)
    return settled.map((result) => {
      if (Result.isFailure(result)) throw result.failure
      return result.success
    })
  })
}

async function generateResearchPrompts(
  input: RunIdeaJobInput,
): Promise<ResearchPrompt[]> {
  const generation = await generateArrayStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildResearchPrompt(input.prompt, input.deepSearchCount),
    promptName: PromptName.GenerateIdeaResearchPrompts,
    element: researchPromptSchema,
    maxOutputTokens: 4_096,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      setGenerationId(
        transaction,
        input.ideaJobId,
        "researchPromptGenerationId",
        generationId,
      )
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "research-prompt-stream",
      streamId: generation.id,
    })
  })

  const prompts = await awaitGenerationOutput(generation, generation.output)
  if (prompts.length !== input.deepSearchCount) {
    throw new Error(
      `Expected ${input.deepSearchCount} research prompts, received ${prompts.length}`,
    )
  }
  if (new Set(prompts.map(({ prompt }) => prompt)).size !== prompts.length) {
    throw new Error("Research prompts must be distinct")
  }
  return prompts
}

function runResearchEffect(
  input: RunIdeaJobInput,
  prompts: ResearchPrompt[],
): Effect.Effect<string[], WorkflowFailure> {
  return Effect.gen(function*() {
    // All child rows are launched before any completion is awaited. Result
    // mode then keeps every successfully launched child joined to the parent.
    const starts = yield* settleEffects(
      prompts.map(({ title, prompt: researchRequest }, ideaJobPosition) =>
        workflowEffect(() => {
          const childInput = {
            title,
            researchRequest,
            maxSearches: input.maxSearches,
            maxResultsPerSearch: input.maxResultsPerSearch,
            maxRounds: input.maxRounds ?? 3,
            ideaJobId: input.ideaJobId,
            ideaJobPosition,
          }
          return input.workflowSignal
            ? input.deepSearchManager.start(input.userId, childInput, {
                workflowSignal: input.workflowSignal,
              })
            : input.deepSearchManager.start(input.userId, childInput)
        }, "Starting idea research failed"),
      ),
    )
    const publicationErrors: unknown[] = []
    starts.forEach((started, index) => {
      if (Result.isFailure(started)) return
      const search = started.success
      try {
        input.job.publish({
          type: "deep-search-started",
          deepSearchJobId: search.deepSearchJobId,
          title: search.title,
          slug: search.slug,
          researchRequest: prompts[index].prompt,
        })
      } catch (error) {
        publicationErrors.push(error)
      }
    })
    const completions = yield* settleEffects(
      starts.map((started) =>
        Result.isFailure(started)
          ? Effect.fail(started.failure)
          : workflowEffect(async () => {
              const value = await started.success.completion
              input.deepSearchManager.requireParentQualityAcceptance(
                started.success.deepSearchJobId,
              )
              return value
            }, "Idea research failed"),
      ),
    )
    if (publicationErrors.length > 0) {
      const publicationError = publicationErrors[0]
      return yield* Effect.fail(
        new WorkflowFailure({
          message: getErrorMessage(
            publicationError,
            "Publishing a child search event failed",
          ),
          cause: publicationError,
        }),
      )
    }
    return yield* unwrapSettled(completions)
  })
}

async function summarizeResearch(
  input: RunIdeaJobInput,
  research: string[],
): Promise<string> {
  // Only the child jobs' final answer texts enter this call. Their intermediate
  // pages and source records remain available through the nested job views.
  const generation = await generateTextStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildSummaryPrompt(input.prompt, research),
    promptName: PromptName.SummarizeIdeaResearch,
    reasoning: "disabled",
    maxOutputTokens: 4_096,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      setGenerationId(
        transaction,
        input.ideaJobId,
        "researchSummaryGenerationId",
        generationId,
      )
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "research-summary-stream",
      streamId: generation.id,
    })
  })
  return awaitGenerationText(generation)
}

async function generateIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
): Promise<Idea[]> {
  const generation = await generateArrayStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildIdeaPrompt(
      input.prompt,
      researchSummary,
      input.numberOfIdeas,
    ),
    promptName: PromptName.GenerateIdeas,
    element: ideaSchema,
    maxOutputTokens: 8_192,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      setGenerationId(
        transaction,
        input.ideaJobId,
        "ideaGenerationId",
        generationId,
      )
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "idea-generation-stream",
      streamId: generation.id,
    })
  })

  const ideas = await awaitGenerationOutput(generation, generation.output)
  if (ideas.length !== input.numberOfIdeas) {
    throw new Error(
      `Expected ${input.numberOfIdeas} ideas, received ${ideas.length}`,
    )
  }
  // Deliberate tradeoff: distinctness remains a prompt-level quality target.
  // Rejecting duplicates needs a product definition of whether equality means
  // identical fields, matching titles, or semantic similarity.
  return ideas
}

function persistIdeas(input: RunIdeaJobInput, ideas: Idea[]): PersistedIdea[] {
  const persistedIdeas = insertIdeaBatch(input.ideaJobId, ideas)
  for (const idea of persistedIdeas) {
    input.job.publish({
      type: "idea",
      ideaId: idea.ideaId,
      title: idea.title,
      description: idea.description,
    })
  }
  return persistedIdeas
}

async function evaluateIdea(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: ResearchedRefinedIdea,
): Promise<IdeaEvaluation> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildEvaluationPrompt(
      input.prompt,
      researchSummary,
      idea,
      idea.supportingResearch,
    ),
    promptName: PromptName.EvaluateIdea,
    schema: ideaEvaluationSchema,
    reasoning: "disabled",
    maxOutputTokens: 1_024,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      const result = transaction
        .update(ideaRecords)
        .set({ evaluationGenerationId: generationId })
        .where(
          and(
            eq(ideaRecords.ideaId, idea.ideaId),
            eq(ideaRecords.ideaJobId, input.ideaJobId),
            isNull(ideaRecords.evaluationGenerationId),
          ),
        )
        .run()
      if (result.changes !== 1) throw new Error("Generated idea was not found")
    },
  })
  const evaluation = await awaitGenerationOutput(
    generation,
    generation.output,
  )
  input.job.publish({
    type: "idea-evaluated",
    ideaId: idea.ideaId,
    ...evaluation,
  })
  return evaluation
}

function evaluateIdeasEffect(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: ResearchedRefinedIdea[],
): Effect.Effect<IdeaEvaluation[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* settleEffects(
      ideas.map((idea) =>
        workflowEffect(
          () => evaluateIdea(input, researchSummary, idea),
          "Idea evaluation failed",
        ),
      ),
    )
    return yield* unwrapSettled(settled)
  })
}

async function selectIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
): Promise<PersistedIdea[]> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildSelectionPrompt(input.prompt, researchSummary, ideas),
    promptName: PromptName.SelectIdeas,
    schema: ideaSelectionProposalSchema,
    // Selection is a small structured transform over an already-complete
    // briefing. Hidden reasoning can consume the entire output budget before
    // DeepSeek emits the required JSON.
    reasoning: "disabled",
    maxOutputTokens: 1_024,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      setGenerationId(
        transaction,
        input.ideaJobId,
        "selectionGenerationId",
        generationId,
      )
    },
    onCompleted: ({ output }, transaction) => {
      const selection = normalizeIdeaSelection(output, ideas)
      const selectedIdeaIds = new Set(selection.selectedIdeaIds)
      for (const { ideaId } of ideas) {
        const result = transaction
          .update(ideaRecords)
          .set({ selected: selectedIdeaIds.has(ideaId) })
          .where(
            and(
              eq(ideaRecords.ideaId, ideaId),
              eq(ideaRecords.ideaJobId, input.ideaJobId),
              isNull(ideaRecords.selected),
            ),
          )
          .run()
        if (result.changes !== 1) {
          throw new Error("Every generated idea must be resolved by selection")
        }
      }
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "idea-selection-stream",
      streamId: generation.id,
    })
  })

  const proposal = await awaitGenerationOutput(
    generation,
    generation.output,
  )
  const selection = normalizeIdeaSelection(proposal, ideas)
  input.job.publish({ type: "selected-ideas", ...selection })
  const selectedIdeaIds = new Set(selection.selectedIdeaIds)
  return ideas.filter(({ ideaId }) => selectedIdeaIds.has(ideaId))
}

async function refineIdea(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: PersistedIdea,
): Promise<RefinedIdea> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildRefinementPrompt(input.prompt, researchSummary, idea),
    promptName: PromptName.RefineIdea,
    schema: ideaSchema,
    maxOutputTokens: 2_048,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      const result = transaction
        .update(ideaRecords)
        .set({ refinementGenerationId: generationId })
        .where(
          and(
            eq(ideaRecords.ideaId, idea.ideaId),
            eq(ideaRecords.ideaJobId, input.ideaJobId),
            eq(ideaRecords.selected, true),
            isNull(ideaRecords.refinementGenerationId),
          ),
        )
        .run()
      if (result.changes !== 1) throw new Error("Selected idea was not found")
    },
    onCompleted: ({ id, output }, transaction) => {
      const result = transaction
        .update(ideaRecords)
        .set({
          refinedTitle: output.title,
          refinedDescription: output.description,
        })
        .where(
          and(
            eq(ideaRecords.ideaId, idea.ideaId),
            eq(ideaRecords.ideaJobId, input.ideaJobId),
            eq(ideaRecords.refinementGenerationId, id),
            isNull(ideaRecords.refinedTitle),
            isNull(ideaRecords.refinedDescription),
          ),
        )
        .run()
      if (result.changes !== 1) {
        throw new Error("Selected idea refinement was not found")
      }
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "idea-refinement-stream",
      ideaId: idea.ideaId,
      streamId: generation.id,
    })
  })

  const refined = await awaitGenerationOutput(generation, generation.output)
  input.job.publish({
    type: "refined-idea",
    ideaId: idea.ideaId,
    ...refined,
  })
  return {
    ...idea,
    refinedTitle: refined.title,
    refinedDescription: refined.description,
  }
}

export type IdeaSiteInput = {
  userId: string
  owner: LlmGenerationOwner
  prompt: string
  workflowSignal?: AbortSignal
}

export async function generateIdeaSite(
  input: IdeaSiteInput,
  researchSummary: string,
  idea: {
    ideaId: string
    refinedTitle: string
    refinedDescription: string
  },
): Promise<void> {
  const generation = await generateTextStream({
    userId: input.userId,
    owner: input.owner,
    prompt: buildIdeaSitePrompt(input.prompt, researchSummary, idea),
    promptName: PromptName.CreateIdeaSite,
    // Generous budget: max reasoning shares it with the complete HTML page,
    // so this only guards against runaway output, not cost. Still capped by
    // the operator's LLM_MAX_OUTPUT_TOKENS ceiling.
    reasoning: "enabled",
    maxOutputTokens: 32_768,
    workflowSignal: input.workflowSignal,
  })
  const html = await awaitGenerationText(generation)
  await writeIdeaSite(idea.ideaId, html)
}

function startIdeaSite(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: RefinedIdea,
): Promise<void> {
  const completion = generateIdeaSite(
    {
      userId: input.userId,
      owner: { ideaJobId: input.ideaJobId },
      prompt: input.prompt,
      workflowSignal: input.workflowSignal,
    },
    researchSummary,
    idea,
  )
  // Keep an early rejection from becoming an unhandled rejection while sibling
  // stages are still running; the coordinator settles it before completion.
  void completion.catch(() => undefined)
  return completion
}

function refineIdeasEffect(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
  onRefined: (idea: RefinedIdea) => void,
): Effect.Effect<RefinedIdea[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* settleEffects(
      ideas.map((idea) =>
        workflowEffect(async () => {
          const refined = await refineIdea(input, researchSummary, idea)
          onRefined(refined)
          return refined
        }, "Idea refinement failed"),
      ),
    )
    return yield* unwrapSettled(settled)
  })
}

async function startRefinedIdeaResearch(
  input: RunIdeaJobInput,
  idea: RefinedIdea,
): ReturnType<DeepSearchJobManager["start"]> {
  const researchRequest = buildRefinedIdeaResearchRequest(input.prompt, idea)
  const childInput = {
    title: idea.refinedTitle,
    researchRequest,
    maxSearches: input.maxSearches,
    maxResultsPerSearch: input.maxResultsPerSearch,
    maxRounds: input.maxRounds ?? 3,
    ideaJobId: input.ideaJobId,
    ideaJobPosition: input.deepSearchCount + idea.position,
  }
  const search = await (input.workflowSignal
    ? input.deepSearchManager.start(input.userId, childInput, {
        workflowSignal: input.workflowSignal,
      })
    : input.deepSearchManager.start(input.userId, childInput))
  try {
    input.job.publish({
      type: "idea-deep-search-started",
      ideaId: idea.ideaId,
      deepSearchJobId: search.deepSearchJobId,
      title: search.title,
      slug: search.slug,
      researchRequest,
    })
  } catch (error) {
    await search.completion.catch(() => undefined)
    throw error
  }
  return search
}

function researchRefinedIdeasEffect(
  input: RunIdeaJobInput,
  ideas: RefinedIdea[],
): Effect.Effect<ResearchedRefinedIdea[], WorkflowFailure> {
  return Effect.gen(function*() {
    const starts = yield* settleEffects(
      ideas.map((idea) =>
        workflowEffect(
          () => startRefinedIdeaResearch(input, idea),
          "Starting selected-idea research failed",
        ),
      ),
    )
    const completions = yield* settleEffects(
      starts.map((started, index) =>
        Result.isFailure(started)
          ? Effect.fail(started.failure)
          : workflowEffect(async () => {
              const supportingResearch = await started.success.completion
              input.deepSearchManager.requireParentQualityAcceptance(
                started.success.deepSearchJobId,
              )
              return { ...ideas[index], supportingResearch }
            }, "Selected-idea research failed"),
      ),
    )
    return yield* unwrapSettled(completions)
  })
}

function ideaPipelineEffect(
  input: RunIdeaJobInput,
  setEventStage: (stage: IdeaEventStage) => void,
  websiteCompletions: Promise<void>[],
): Effect.Effect<void, WorkflowFailure> {
  return Effect.gen(function*() {
    const prompts = yield* workflowEffect(() => generateResearchPrompts(input))

    setEventStage("research")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "research"))
    const research = yield* runResearchEffect(input, prompts)

    setEventStage("summary")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "summary"))
    const summary = yield* workflowEffect(() => summarizeResearch(input, research))

    setEventStage("ideas")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "ideas"))
    const generatedIdeas = yield* workflowEffect(() =>
      generateIdeas(input, summary),
    )
    const persistedIdeas = yield* workflowEffect(() =>
      persistIdeas(input, generatedIdeas),
    )

    setEventStage("selection")
    const selectedIdeas = yield* workflowEffect(() =>
      selectIdeas(input, summary, persistedIdeas),
    )

    setEventStage("refinement")
    // Each selected idea's website generation starts as soon as its own
    // refinement commits, so every website builds concurrently with the
    // remaining research and evaluation stages.
    const refinedIdeas = yield* refineIdeasEffect(
      input,
      summary,
      selectedIdeas,
      (refined) => {
        websiteCompletions.push(startIdeaSite(input, summary, refined))
      },
    )

    // Research and evaluation run while the started websites keep generating;
    // every branch settles before the parent can complete. Website failures
    // are deliberately fatal: a generated site is part of the deliverable, so
    // one missing site fails the whole idea job (and therefore the debate)
    // rather than completing with a degraded result.
    const settledDownstream = yield* settleEffects([
      Effect.gen(function*() {
        setEventStage("idea-research")
        const researchedIdeas = yield* researchRefinedIdeasEffect(
          input,
          refinedIdeas,
        )

        setEventStage("evaluation")
        yield* evaluateIdeasEffect(input, summary, researchedIdeas)

        setEventStage("website")
      }),
      ...websiteCompletions.map((completion) =>
        workflowEffect(() => completion, "Idea website generation failed"),
      ),
    ])
    yield* unwrapSettled(settledDownstream)

    yield* workflowEffect(() => completeIdeaJob(input.ideaJobId))
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
    return error.root?.kind === "idea" ? "user-stop" : "parent-stop"
  }
}

function durableIdeaStage(stage: IdeaEventStage): IdeaJobStage {
  return stage === "evaluation" ||
    stage === "selection" ||
    stage === "refinement" ||
    stage === "idea-research" ||
    stage === "website"
    ? "ideas"
    : stage
}

/** Runs the Effect-owned pipeline and owns the exact terminal event suffix. */
export async function runIdeaJob(input: RunIdeaJobInput): Promise<void> {
  let stage: IdeaEventStage = "planning"
  // Started websites keep their own durable generation lifecycle. The failure
  // path still settles them so the parent never becomes terminal while a
  // website stream is running.
  const websiteCompletions: Promise<void>[] = []
  try {
    await runWorkflowEffect(
      ideaPipelineEffect(
        input,
        (nextStage) => {
          stage = nextStage
        },
        websiteCompletions,
      ),
      input.workflowSignal,
    )
  } catch (error) {
    await Promise.allSettled(websiteCompletions)
    let cancellationReason = getCancellationReason(error, input.workflowSignal)
    const message = getErrorMessage(error, "Idea generation failed")
    if (!cancellationReason) {
      try {
        failIdeaJob(input.ideaJobId, durableIdeaStage(stage), message)
      } catch (persistenceError) {
        cancellationReason = getCancellationReason(
          persistenceError,
          input.workflowSignal,
        )
        if (!cancellationReason) {
          console.error(
            `Failed to persist idea job ${input.ideaJobId} failure`,
            persistenceError,
          )
        }
      }
    }
    if (cancellationReason) {
      const interrupted = new WorkflowInterruptedError(cancellationReason)
      interruptIdeaJob(input.ideaJobId, interrupted.message)
      input.job.publish({ type: "interrupted", message: interrupted.message })
      return
    }
    input.job.publish({ type: "error", message, stage })
  } finally {
    // Every event subscription has exactly one terminal marker, regardless of
    // whether the durable job completed or failed.
    input.job.publish({ type: "done" })
    input.job.close()
  }
}
