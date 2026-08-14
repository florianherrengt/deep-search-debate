import { and, eq } from "drizzle-orm"
import z from "zod"
import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import { ideaJobs, ideas as ideaRecords } from "../../db/schema/index.ts"
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
  idea: Idea,
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    "<generated_idea>",
    JSON.stringify(idea),
    "</generated_idea>",
  ].join("\n")
}

type EvaluatedIdea = PersistedIdea & IdeaEvaluation
type RefinedIdea = EvaluatedIdea & {
  refinedTitle: string
  refinedDescription: string
}

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
  idea: EvaluatedIdea,
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
    "<evaluation>",
    JSON.stringify({
      pros: idea.pros,
      cons: idea.cons,
      critique: idea.critique,
    }),
    "</evaluation>",
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
  ideas: EvaluatedIdea[],
): string {
  const briefing = truncateMiddle(
    researchSummary,
    Math.floor(config.deepSearch.maxSummaryContextChars * 0.2),
  )
  const evaluatedIdeas = formatBoundedTextEntries(
    ideas.map((idea) => ({
      opening: "<evaluated_idea>\n",
      text: JSON.stringify({
        ideaId: idea.ideaId,
        title: idea.title,
        description: idea.description,
        pros: idea.pros,
        cons: idea.cons,
        critique: idea.critique,
      }),
      closing: "\n</evaluated_idea>",
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
    "<evaluated_ideas>",
    evaluatedIdeas,
    "</evaluated_ideas>",
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
  const result = transaction
    .update(ideaJobs)
    .set({ [field]: id })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
  if (result.changes !== 1) throw new Error("Idea job was not found")
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

function setStage(ideaJobId: string, stage: IdeaJobStage): void {
  db.update(ideaJobs)
    .set({ stage })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
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

async function runResearch(
  input: RunIdeaJobInput,
  prompts: ResearchPrompt[],
): Promise<string[]> {
  // start() launches immediately. Mapping every prompt before awaiting any
  // completion is what makes these durable child jobs run in parallel.
  const starts = await Promise.allSettled(
    prompts.map(({ title, prompt: researchRequest }, ideaJobPosition) =>
      input.deepSearchManager.start(input.userId, {
        title,
        researchRequest,
        maxSearches: input.maxSearches,
        maxResultsPerSearch: input.maxResultsPerSearch,
        maxRounds: input.maxRounds ?? 3,
        ideaJobId: input.ideaJobId,
        ideaJobPosition,
      }),
    ),
  )
  const publicationErrors = starts.flatMap((started, index): unknown[] => {
    if (started.status === "rejected") return []
    const search = started.value
    try {
      input.job.publish({
        type: "deep-search-started",
        deepSearchJobId: search.deepSearchJobId,
        title: search.title,
        slug: search.slug,
        researchRequest: prompts[index].prompt,
      })
      return []
    } catch (error) {
      return [error]
    }
  })

  // Wait for every launched child even after one fails. No later pipeline stage
  // runs when a rejection exists, but the parent does not terminate while its
  // remaining visible child searches are still active.
  const settled = await Promise.all(
    starts.map(
      async (started): Promise<PromiseSettledResult<string>> => {
        if (started.status === "rejected") return started
        try {
          const value = await started.value.completion
          input.deepSearchManager.requireParentQualityAcceptance(
            started.value.deepSearchJobId,
          )
          return {
            status: "fulfilled",
            value,
          }
        } catch (reason) {
          return { status: "rejected", reason }
        }
      },
    ),
  )
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (publicationErrors.length > 0) {
    const [publicationError] = publicationErrors
    throw publicationError instanceof Error
      ? publicationError
      : new Error("Publishing a child search event failed")
  }
  if (failed) throw failed.reason
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason
    return result.value
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

type PersistedIdea = Idea & { ideaId: string; position: number }

function persistIdeas(input: RunIdeaJobInput, ideas: Idea[]): PersistedIdea[] {
  const persistedIdeas = ideas.map((idea, position) => ({
    ideaId: crypto.randomUUID(),
    ideaJobId: input.ideaJobId,
    position,
    ...idea,
  }))
  db.insert(ideaRecords).values(persistedIdeas).run()
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
  idea: PersistedIdea,
): Promise<EvaluatedIdea> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildEvaluationPrompt(input.prompt, researchSummary, {
      title: idea.title,
      description: idea.description,
    }),
    promptName: PromptName.EvaluateIdea,
    schema: ideaEvaluationSchema,
    reasoning: "disabled",
    maxOutputTokens: 1_024,
    onRegistered: (generationId, transaction) => {
      const result = transaction
        .update(ideaRecords)
        .set({ evaluationGenerationId: generationId })
        .where(
          and(
            eq(ideaRecords.ideaId, idea.ideaId),
            eq(ideaRecords.ideaJobId, input.ideaJobId),
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
  return { ...idea, ...evaluation }
}

async function evaluateIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
): Promise<EvaluatedIdea[]> {
  // Start every independent evaluation immediately, but do not fail the parent
  // until all started generations have reached a terminal state.
  const settled = await Promise.allSettled(
    ideas.map((idea) => evaluateIdea(input, researchSummary, idea)),
  )
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failed) throw failed.reason
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason
    return result.value
  })
}

async function selectIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: EvaluatedIdea[],
): Promise<EvaluatedIdea[]> {
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
  idea: EvaluatedIdea,
): Promise<RefinedIdea> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildRefinementPrompt(input.prompt, researchSummary, idea),
    promptName: PromptName.RefineIdea,
    schema: ideaSchema,
    maxOutputTokens: 2_048,
    onRegistered: (generationId, transaction) => {
      const result = transaction
        .update(ideaRecords)
        .set({ refinementGenerationId: generationId })
        .where(
          and(
            eq(ideaRecords.ideaId, idea.ideaId),
            eq(ideaRecords.ideaJobId, input.ideaJobId),
            eq(ideaRecords.selected, true),
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

async function refineIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: EvaluatedIdea[],
): Promise<RefinedIdea[]> {
  const settled = await Promise.allSettled(
    ideas.map((idea) => refineIdea(input, researchSummary, idea)),
  )
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failed) throw failed.reason
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason
    return result.value
  })
}

async function researchRefinedIdea(
  input: RunIdeaJobInput,
  idea: RefinedIdea,
): Promise<void> {
  const researchRequest = buildRefinedIdeaResearchRequest(input.prompt, idea)
  const search = await input.deepSearchManager.start(input.userId, {
    title: idea.refinedTitle,
    researchRequest,
    maxSearches: input.maxSearches,
    maxResultsPerSearch: input.maxResultsPerSearch,
    maxRounds: input.maxRounds ?? 3,
    ideaJobId: input.ideaJobId,
    ideaJobPosition: input.deepSearchCount + idea.position,
  })
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
  await search.completion
  input.deepSearchManager.requireParentQualityAcceptance(
    search.deepSearchJobId,
  )
}

async function researchRefinedIdeas(
  input: RunIdeaJobInput,
  ideas: RefinedIdea[],
): Promise<void> {
  const settled = await Promise.allSettled(
    ideas.map((idea) => researchRefinedIdea(input, idea)),
  )
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failed) throw failed.reason
}

/** Runs the durable idea pipeline and publishes parent progress. */
export async function runIdeaJob(input: RunIdeaJobInput): Promise<void> {
  let stage: IdeaEventStage = "planning"
  try {
    const prompts = await generateResearchPrompts(input)

    stage = "research"
    setStage(input.ideaJobId, stage)
    const research = await runResearch(input, prompts)

    stage = "summary"
    setStage(input.ideaJobId, stage)
    const summary = await summarizeResearch(input, research)

    stage = "ideas"
    setStage(input.ideaJobId, stage)
    const generatedIdeas = await generateIdeas(input, summary)
    const persistedIdeas = persistIdeas(input, generatedIdeas)

    stage = "evaluation"
    const evaluatedIdeas = await evaluateIdeas(input, summary, persistedIdeas)

    stage = "selection"
    const selectedIdeas = await selectIdeas(input, summary, evaluatedIdeas)

    stage = "refinement"
    const refinedIdeas = await refineIdeas(input, summary, selectedIdeas)

    stage = "idea-research"
    await researchRefinedIdeas(input, refinedIdeas)

    db.update(ideaJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(ideaJobs.ideaJobId, input.ideaJobId))
      .run()
  } catch (error) {
    const message = getErrorMessage(error, "Idea generation failed")
    try {
      db.update(ideaJobs)
        .set({
          // Per-idea work remains an event subphase of the durable ideas stage.
          // Linked generations and searches preserve its detailed progress.
          stage:
            stage === "evaluation" ||
            stage === "selection" ||
            stage === "refinement" ||
            stage === "idea-research"
              ? "ideas"
              : stage,
          status: "failed",
          error: message,
          completedAt: new Date(),
        })
        .where(eq(ideaJobs.ideaJobId, input.ideaJobId))
        .run()
    } catch (persistenceError) {
      console.error(
        `Failed to persist idea job ${input.ideaJobId} failure`,
        persistenceError,
      )
    }
    input.job.publish({ type: "error", message, stage })
  } finally {
    // Every event subscription has exactly one terminal marker, regardless of
    // whether the durable job completed or failed.
    input.job.publish({ type: "done" })
    input.job.close()
  }
}
