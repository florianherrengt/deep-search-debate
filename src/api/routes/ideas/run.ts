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
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { EffectiveResearchRootInactiveError } from "../researchCancellation.ts"
import { deepSearchResearchRequestSchema } from "../deepSearch/resourceLimits.ts"
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
  loadIdeaExecutionSnapshot,
  setIdeaGeneration,
  setIdeaJobGeneration,
  setIdeaJobStage,
  type PersistedIdeaGeneration,
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
  maxRounds: number
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
  expectedGenerationId: string | null,
): void {
  setIdeaJobGeneration(transaction, {
    ideaJobId,
    field,
    generationId: id,
    expectedGenerationId,
  })
}

function getCompletedGenerationText(
  generation: PersistedIdeaGeneration,
  stage: string,
): string {
  if (generation.status !== "completed") {
    throw new Error(`${stage} generation is not completed`)
  }
  if (!generation.text?.trim()) {
    throw new Error(`${stage} generation has no persisted output`)
  }
  return generation.text
}

function parsePersistedArray<Element>(
  generation: PersistedIdeaGeneration,
  stage: string,
  element: z.ZodType<Element>,
): Element[] {
  return z
    .object({ elements: z.array(element) })
    .parse(JSON.parse(getCompletedGenerationText(generation, stage))).elements
}

function loadSnapshot(ideaJobId: string) {
  const snapshot = loadIdeaExecutionSnapshot(ideaJobId)
  if (!snapshot) throw new Error("Idea job was not found")
  return snapshot
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

function validateResearchPrompts(
  prompts: ResearchPrompt[],
  expectedCount: number,
): ResearchPrompt[] {
  if (prompts.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} research prompts, received ${prompts.length}`,
    )
  }
  if (new Set(prompts.map(({ prompt }) => prompt)).size !== prompts.length) {
    throw new Error("Research prompts must be distinct")
  }
  return prompts
}

async function ensureResearchPrompts(
  input: RunIdeaJobInput,
): Promise<ResearchPrompt[]> {
  const checkpoint = loadSnapshot(input.ideaJobId).researchPromptGeneration
  if (checkpoint?.status === "completed") {
    return validateResearchPrompts(
      parsePersistedArray(checkpoint, "Planning", researchPromptSchema),
      input.deepSearchCount,
    )
  }
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
        checkpoint?.generationId ?? null,
      )
    },
    onCompleted: ({ output }) => {
      validateResearchPrompts(output, input.deepSearchCount)
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "research-prompt-stream",
      streamId: generation.id,
    })
  })

  return validateResearchPrompts(
    await awaitGenerationOutput(generation, generation.output),
    input.deepSearchCount,
  )
}

function runResearchEffect(
  input: RunIdeaJobInput,
  prompts: ResearchPrompt[],
): Effect.Effect<string[], WorkflowFailure> {
  return Effect.gen(function*() {
    const childrenByPosition = new Map(
      loadSnapshot(input.ideaJobId).children.map((child) => [
        child.position,
        child,
      ]),
    )
    const starts = yield* settleEffects(
      prompts.map(({ title, prompt: researchRequest }, ideaJobPosition) =>
        workflowEffect(() => {
          const existing = childrenByPosition.get(ideaJobPosition)
          if (existing?.status === "completed") {
            if (!existing.finalAnswer?.trim()) {
              throw new Error("Completed idea research has no final answer")
            }
            return {
              deepSearchJobId: existing.deepSearchJobId,
              title: existing.title,
              slug: existing.slug,
              completion: Promise.resolve(existing.finalAnswer),
              publishStarted: false,
            }
          }
          if (existing) {
            const resumed = input.deepSearchManager.resumeExisting(
              existing.deepSearchJobId,
              input.workflowSignal
                ? { workflowSignal: input.workflowSignal }
                : undefined,
            )
            return { ...resumed, publishStarted: false }
          }
          const childInput = {
            title,
            researchRequest,
            maxSearches: input.maxSearches,
            maxResultsPerSearch: input.maxResultsPerSearch,
            maxRounds: input.maxRounds,
            ideaJobId: input.ideaJobId,
            ideaJobPosition,
          }
          const started = input.workflowSignal
            ? input.deepSearchManager.start(input.userId, childInput, {
                workflowSignal: input.workflowSignal,
              })
            : input.deepSearchManager.start(input.userId, childInput)
          return Promise.resolve(started).then((search) => ({
            ...search,
            publishStarted: true,
          }))
        }, "Starting idea research failed"),
      ),
    )
    const publicationErrors: unknown[] = []
    starts.forEach((started, index) => {
      if (Result.isFailure(started)) return
      const search = started.success
      if (!search.publishStarted) return
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
          : workflowEffect(
              () => started.success.completion,
              "Idea research failed",
            ),
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

async function ensureResearchSummary(
  input: RunIdeaJobInput,
  research: string[],
): Promise<string> {
  const checkpoint = loadSnapshot(input.ideaJobId).researchSummaryGeneration
  if (checkpoint?.status === "completed") {
    return getCompletedGenerationText(checkpoint, "Research summary")
  }
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
        checkpoint?.generationId ?? null,
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

function validateGeneratedIdeas(
  generated: Idea[],
  expectedCount: number,
): Idea[] {
  if (generated.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} ideas, received ${generated.length}`,
    )
  }
  return generated
}

function assertPersistedIdeasMatch(
  persisted: PersistedIdea[],
  generated: Idea[],
): void {
  if (
    persisted.length !== generated.length ||
    persisted.some(
      (idea, position) =>
        idea.position !== position ||
        idea.title !== generated[position]?.title ||
        idea.description !== generated[position]?.description,
    )
  ) {
    throw new Error("Persisted ideas conflict with completed generation output")
  }
}

async function ensureIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
): Promise<{ ideas: PersistedIdea[]; publish: boolean }> {
  const before = loadSnapshot(input.ideaJobId)
  const checkpoint = before.ideaGeneration
  if (checkpoint?.status === "completed") {
    const generated = validateGeneratedIdeas(
      parsePersistedArray(checkpoint, "Idea", ideaSchema),
      input.numberOfIdeas,
    )
    assertPersistedIdeasMatch(before.ideas, generated)
    return { ideas: before.ideas, publish: false }
  }
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
        checkpoint?.generationId ?? null,
      )
    },
    onCompleted: ({ output }, transaction) => {
      insertIdeaBatch(
        transaction,
        input.ideaJobId,
        validateGeneratedIdeas(output, input.numberOfIdeas),
      )
    },
  })
  await publishStartedGeneration(generation, () => {
    input.job.publish({
      type: "idea-generation-stream",
      streamId: generation.id,
    })
  })

  const generated = validateGeneratedIdeas(
    await awaitGenerationOutput(generation, generation.output),
    input.numberOfIdeas,
  )
  // Deliberate tradeoff: distinctness remains a prompt-level quality target.
  // Rejecting duplicates needs a product definition of whether equality means
  // identical fields, matching titles, or semantic similarity.
  const persisted = loadSnapshot(input.ideaJobId).ideas
  assertPersistedIdeasMatch(persisted, generated)
  return { ideas: persisted, publish: true }
}

function publishIdeas(input: RunIdeaJobInput, ideas: PersistedIdea[]): void {
  for (const idea of ideas) {
    input.job.publish({
      type: "idea",
      ideaId: idea.ideaId,
      title: idea.title,
      description: idea.description,
    })
  }
}

async function evaluateIdea(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: ResearchedRefinedIdea,
): Promise<IdeaEvaluation> {
  const checkpoint = loadSnapshot(input.ideaJobId).ideas.find(
    ({ ideaId }) => ideaId === idea.ideaId,
  )?.evaluationGeneration
  if (checkpoint?.status === "completed") {
    return ideaEvaluationSchema.parse(
      JSON.parse(getCompletedGenerationText(checkpoint, "Idea evaluation")),
    )
  }
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
      setIdeaGeneration(transaction, {
        ideaJobId: input.ideaJobId,
        ideaId: idea.ideaId,
        field: "evaluationGenerationId",
        generationId,
        expectedGenerationId: checkpoint?.generationId ?? null,
      })
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
  const before = loadSnapshot(input.ideaJobId)
  const checkpoint = before.selectionGeneration
  if (checkpoint?.status === "completed") {
    const proposal = ideaSelectionProposalSchema.parse(
      JSON.parse(getCompletedGenerationText(checkpoint, "Idea selection")),
    )
    const selection = normalizeIdeaSelection(proposal, ideas)
    const selectedIdeaIds = new Set(selection.selectedIdeaIds)
    if (before.ideas.some(({ selected }) => selected === null)) {
      throw new Error("Completed idea selection is not durably applied")
    }
    if (
      before.ideas.some(
        ({ ideaId, selected }) => selected !== selectedIdeaIds.has(ideaId),
      )
    ) {
      throw new Error("Persisted idea selection conflicts with generation output")
    }
    return loadSnapshot(input.ideaJobId).ideas.filter(({ selected }) => selected)
  }
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
        checkpoint?.generationId ?? null,
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
  const persisted = loadSnapshot(input.ideaJobId).ideas.find(
    ({ ideaId }) => ideaId === idea.ideaId,
  )
  if (!persisted) throw new Error("Selected idea was not found")
  const checkpoint = persisted.refinementGeneration
  if (checkpoint?.status === "completed") {
    const refined = ideaSchema.parse(
      JSON.parse(getCompletedGenerationText(checkpoint, "Idea refinement")),
    )
    if (
      (persisted.refinedTitle === null) !==
      (persisted.refinedDescription === null)
    ) {
      throw new Error("Idea refinement is only partially persisted")
    }
    if (persisted.refinedTitle === null) {
      throw new Error("Completed idea refinement is not durably applied")
    }
    if (
      persisted.refinedTitle !== refined.title ||
      persisted.refinedDescription !== refined.description
    ) {
      throw new Error("Persisted refinement conflicts with generation output")
    }
    return {
      ...persisted,
      refinedTitle: refined.title,
      refinedDescription: refined.description,
    }
  }
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildRefinementPrompt(input.prompt, researchSummary, idea),
    promptName: PromptName.RefineIdea,
    schema: ideaSchema,
    maxOutputTokens: 2_048,
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      setIdeaGeneration(transaction, {
        ideaJobId: input.ideaJobId,
        ideaId: idea.ideaId,
        field: "refinementGenerationId",
        generationId,
        expectedGenerationId: checkpoint?.generationId ?? null,
      })
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

function refineIdeasEffect(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
): Effect.Effect<RefinedIdea[], WorkflowFailure> {
  return Effect.gen(function*() {
    const settled = yield* settleEffects(
      ideas.map((idea) =>
        workflowEffect(
          () => refineIdea(input, researchSummary, idea),
          "Idea refinement failed",
        ),
      ),
    )
    return yield* unwrapSettled(settled)
  })
}

async function ensureRefinedIdeaResearch(
  input: RunIdeaJobInput,
  idea: RefinedIdea,
): ReturnType<DeepSearchJobManager["start"]> {
  const position = input.deepSearchCount + idea.position
  const existing = loadSnapshot(input.ideaJobId).children.find(
    (child) => child.position === position,
  )
  if (existing?.status === "completed") {
    if (!existing.finalAnswer?.trim()) {
      throw new Error("Completed selected-idea research has no final answer")
    }
    return {
      deepSearchJobId: existing.deepSearchJobId,
      title: existing.title,
      slug: existing.slug,
      completion: Promise.resolve(existing.finalAnswer),
    }
  }
  if (existing) {
    return input.deepSearchManager.resumeExisting(
      existing.deepSearchJobId,
      input.workflowSignal
        ? { workflowSignal: input.workflowSignal }
        : undefined,
    )
  }
  const researchRequest = buildRefinedIdeaResearchRequest(input.prompt, idea)
  const childInput = {
    title: idea.refinedTitle,
    researchRequest,
    maxSearches: input.maxSearches,
    maxResultsPerSearch: input.maxResultsPerSearch,
    maxRounds: input.maxRounds,
    ideaJobId: input.ideaJobId,
    ideaJobPosition: position,
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
          () => ensureRefinedIdeaResearch(input, idea),
          "Starting selected-idea research failed",
        ),
      ),
    )
    const completions = yield* settleEffects(
      starts.map((started, index) =>
        Result.isFailure(started)
          ? Effect.fail(started.failure)
          : workflowEffect(async () => ({
              ...ideas[index],
              supportingResearch: await started.success.completion,
            }), "Selected-idea research failed"),
      ),
    )
    return yield* unwrapSettled(completions)
  })
}

function ideaPipelineEffect(
  input: RunIdeaJobInput,
  setEventStage: (stage: IdeaEventStage) => void,
): Effect.Effect<void, WorkflowFailure> {
  return Effect.gen(function*() {
    const prompts = yield* workflowEffect(() => ensureResearchPrompts(input))

    setEventStage("research")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "research"))
    const research = yield* runResearchEffect(input, prompts)

    setEventStage("summary")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "summary"))
    const summary = yield* workflowEffect(() =>
      ensureResearchSummary(input, research),
    )

    setEventStage("ideas")
    yield* workflowEffect(() => setIdeaJobStage(input.ideaJobId, "ideas"))
    const ensuredIdeas = yield* workflowEffect(() => ensureIdeas(input, summary))
    if (ensuredIdeas.publish) {
      yield* workflowEffect(() => publishIdeas(input, ensuredIdeas.ideas))
    }
    const persistedIdeas = ensuredIdeas.ideas

    setEventStage("selection")
    const selectedIdeas = yield* workflowEffect(() =>
      selectIdeas(input, summary, persistedIdeas),
    )

    setEventStage("refinement")
    const refinedIdeas = yield* refineIdeasEffect(input, summary, selectedIdeas)

    setEventStage("idea-research")
    const researchedIdeas = yield* researchRefinedIdeasEffect(
      input,
      refinedIdeas,
    )

    setEventStage("evaluation")
    yield* evaluateIdeasEffect(input, summary, researchedIdeas)

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
    stage === "idea-research"
    ? "ideas"
    : stage
}

/** Runs the Effect-owned pipeline and owns the exact terminal event suffix. */
export async function runIdeaJob(input: RunIdeaJobInput): Promise<void> {
  let executionInput = input
  let stage: IdeaEventStage = "planning"
  try {
    const persisted = loadSnapshot(input.ideaJobId)
    if (persisted.status !== "running") {
      throw new Error("Idea job must be reopened before execution")
    }
    executionInput = {
      ...input,
      userId: persisted.userId,
      prompt: persisted.prompt,
      numberOfIdeas: persisted.numberOfIdeas,
      deepSearchCount: persisted.deepSearchCount,
      maxSearches: persisted.maxSearches,
      maxResultsPerSearch: persisted.maxResultsPerSearch,
      maxRounds: persisted.maxRounds,
    }
    await runWorkflowEffect(
      ideaPipelineEffect(executionInput, (nextStage) => {
        stage = nextStage
      }),
      executionInput.workflowSignal,
    )
  } catch (error) {
    let cancellationReason = getCancellationReason(
      error,
      executionInput.workflowSignal,
    )
    const message = getErrorMessage(error, "Idea generation failed")
    if (!cancellationReason) {
      try {
        failIdeaJob(input.ideaJobId, durableIdeaStage(stage), message)
      } catch (persistenceError) {
        cancellationReason = getCancellationReason(
          persistenceError,
          executionInput.workflowSignal,
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
