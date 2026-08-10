import { and, eq } from "drizzle-orm"
import z from "zod"
import { db } from "../../db/index.ts"
import { ideaJobs, ideas as ideaRecords } from "../../db/schema/index.ts"
import { collectStreamText } from "../../helpers/collectStreamText.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  generateArrayStream,
  generateObjectStream,
  generateTextStream,
} from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import {
  ideaSchema,
  ideaSelectionSchema,
  type Idea,
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
  maxRetries?: number
  job: LiveIdeaJob
  deepSearchManager: DeepSearchJobManager
}

const researchPromptSchema = z.object({
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1),
})
type ResearchPrompt = z.infer<typeof researchPromptSchema>

function buildResearchPrompt(prompt: string, count: number): string {
  return `User request:\n${prompt}\n\nGenerate exactly ${count} deep-search prompts.`
}

function buildSummaryPrompt(prompt: string, research: string[]): string {
  const results = research
    .map(
      (text, index) =>
        [
          `<research_text index="${index + 1}">`,
          text,
          "</research_text>",
        ].join("\n"),
    )
    .join("\n\n")
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

function buildCritiquePrompt(
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

type CritiquedIdea = PersistedIdea & { critique: string }
type RefinedIdea = CritiquedIdea & {
  refinedTitle: string
  refinedDescription: string
}

function buildRefinementPrompt(
  prompt: string,
  researchSummary: string,
  idea: CritiquedIdea,
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
    "<critique>",
    idea.critique,
    "</critique>",
  ].join("\n")
}

function buildRefinedIdeaResearchRequest(
  prompt: string,
  idea: RefinedIdea,
): string {
  return [
    "Research this proposed idea in relation to the user's request. Investigate relevant evidence, comparable approaches, feasibility, risks, and practical implementation considerations.",
    "<user_request>",
    prompt,
    "</user_request>",
    "<refined_idea>",
    JSON.stringify({
      title: idea.refinedTitle,
      description: idea.refinedDescription,
    }),
    "</refined_idea>",
  ].join("\n")
}

function buildSelectionPrompt(
  prompt: string,
  researchSummary: string,
  ideas: CritiquedIdea[],
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    "<critiqued_ideas>",
    ...ideas.flatMap((idea) => [
      "<critiqued_idea>",
      JSON.stringify({
        ideaId: idea.ideaId,
        title: idea.title,
        description: idea.description,
        critique: idea.critique,
      }),
      "</critiqued_idea>",
    ]),
    "</critiqued_ideas>",
  ].join("\n")
}

function setGenerationId(
  ideaJobId: string,
  field:
    | "researchPromptGenerationId"
    | "researchSummaryGenerationId"
    | "ideaGenerationId"
    | "selectionGenerationId",
  id: string,
): void {
  // Link the generation before advertising its stream ID. A client can then
  // refresh immediately and reconstruct the same stage from durable state.
  db.update(ideaJobs)
    .set({ [field]: id })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
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
    maxRetries: input.maxRetries,
  })
  setGenerationId(
    input.ideaJobId,
    "researchPromptGenerationId",
    generation.id,
  )
  input.job.publish({
    type: "research-prompt-stream",
    streamId: generation.id,
  })

  // Await both views of the same invocation: `output` validates the structured
  // array while collectStreamText waits for raw text/reasoning persistence and
  // propagates provider stream errors.
  const [prompts] = await Promise.all([
    generation.output,
    collectStreamText({ id: generation.id }),
  ])
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
        ideaJobId: input.ideaJobId,
        ideaJobPosition,
        maxRetries: input.maxRetries,
      }),
    ),
  )
  for (const [index, started] of starts.entries()) {
    if (started.status === "rejected") continue
    const search = started.value
    input.job.publish({
      type: "deep-search-started",
      deepSearchJobId: search.deepSearchJobId,
      title: search.title,
      slug: search.slug,
      researchRequest: prompts[index].prompt,
    })
  }

  // Wait for every launched child even after one fails. No later pipeline stage
  // runs when a rejection exists, but the parent does not terminate while its
  // remaining visible child searches are still active.
  const settled = await Promise.all(
    starts.map(
      async (started): Promise<PromiseSettledResult<string>> => {
        if (started.status === "rejected") return started
        try {
          return {
            status: "fulfilled",
            value: await started.value.completion,
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
    maxRetries: input.maxRetries,
  })
  setGenerationId(
    input.ideaJobId,
    "researchSummaryGenerationId",
    generation.id,
  )
  input.job.publish({
    type: "research-summary-stream",
    streamId: generation.id,
  })
  return collectStreamText(generation)
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
    maxRetries: input.maxRetries,
  })
  setGenerationId(input.ideaJobId, "ideaGenerationId", generation.id)
  input.job.publish({
    type: "idea-generation-stream",
    streamId: generation.id,
  })

  // Consume both complete representations concurrently:
  // - output validates and returns the complete array;
  // - collectStreamText retains raw JSON and reasoning for replay/debugging.
  const [ideas] = await Promise.all([
    generation.output,
    collectStreamText({ id: generation.id }),
  ])
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

function attachCritiqueGeneration(ideaId: string, generationId: string): void {
  const result = db
    .update(ideaRecords)
    .set({ critiqueGenerationId: generationId })
    .where(eq(ideaRecords.ideaId, ideaId))
    .run()
  if (result.changes !== 1) throw new Error("Generated idea was not found")
}

async function critiqueIdea(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: PersistedIdea,
): Promise<CritiquedIdea> {
  const generation = await generateTextStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildCritiquePrompt(input.prompt, researchSummary, {
      title: idea.title,
      description: idea.description,
    }),
    promptName: PromptName.CritiqueIdea,
    // TODO: Revisit critique reasoning when Flash reliably terminates these
    // streams. It can currently loop without ever emitting answer text, while
    // a critique only needs the answer prose.
    reasoning: "disabled",
    maxRetries: input.maxRetries,
  })
  try {
    attachCritiqueGeneration(idea.ideaId, generation.id)
    input.job.publish({
      type: "critique-generation-stream",
      position: idea.position,
      streamId: generation.id,
    })
  } catch (error) {
    // The provider invocation is already consuming. Wait for it before failing
    // the parent so no started generation outlives the terminal job event.
    await collectStreamText(generation).catch(() => undefined)
    throw error
  }
  const critique = await collectStreamText(generation)
  return { ...idea, critique }
}

async function critiqueIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
): Promise<CritiquedIdea[]> {
  // Start every independent critique immediately, but do not fail the parent
  // until all started generations have reached a terminal state.
  const settled = await Promise.allSettled(
    ideas.map((idea) => critiqueIdea(input, researchSummary, idea)),
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
  ideas: CritiquedIdea[],
): Promise<CritiquedIdea[]> {
  const knownIdeaIds = new Set(ideas.map(({ ideaId }) => ideaId))
  const selectionSchema = ideaSelectionSchema.superRefine(
    ({ selectedIdeaIds }, context) => {
      if (selectedIdeaIds.some((ideaId) => !knownIdeaIds.has(ideaId))) {
        context.addIssue({
          code: "custom",
          message: "Every selected idea ID must belong to this idea job",
          path: ["selectedIdeaIds"],
        })
      }
    },
  )
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildSelectionPrompt(input.prompt, researchSummary, ideas),
    promptName: PromptName.SelectIdeas,
    schema: selectionSchema,
    reasoning: "enabled",
    maxRetries: input.maxRetries,
    onCompleted: ({ output }, transaction) => {
      const selectedIdeaIds = new Set(output.selectedIdeaIds)
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
  setGenerationId(input.ideaJobId, "selectionGenerationId", generation.id)
  input.job.publish({
    type: "idea-selection-stream",
    streamId: generation.id,
  })

  const [selection] = await Promise.all([
    generation.output,
    collectStreamText({ id: generation.id }),
  ])
  input.job.publish({ type: "selected-ideas", ...selection })
  const selectedIdeaIds = new Set(selection.selectedIdeaIds)
  return ideas.filter(({ ideaId }) => selectedIdeaIds.has(ideaId))
}

function attachRefinementGeneration(
  ideaJobId: string,
  ideaId: string,
  generationId: string,
): void {
  const result = db
    .update(ideaRecords)
    .set({ refinementGenerationId: generationId })
    .where(
      and(
        eq(ideaRecords.ideaId, ideaId),
        eq(ideaRecords.ideaJobId, ideaJobId),
        eq(ideaRecords.selected, true),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Selected idea was not found")
}

async function refineIdea(
  input: RunIdeaJobInput,
  researchSummary: string,
  idea: CritiquedIdea,
): Promise<RefinedIdea> {
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildRefinementPrompt(input.prompt, researchSummary, idea),
    promptName: PromptName.RefineIdea,
    schema: ideaSchema,
    maxRetries: input.maxRetries,
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
  try {
    attachRefinementGeneration(input.ideaJobId, idea.ideaId, generation.id)
    input.job.publish({
      type: "idea-refinement-stream",
      ideaId: idea.ideaId,
      streamId: generation.id,
    })
  } catch (error) {
    await collectStreamText(generation).catch(() => undefined)
    throw error
  }

  const [refined] = await Promise.all([
    generation.output,
    collectStreamText(generation),
  ])
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
  ideas: CritiquedIdea[],
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

function attachIdeaDeepSearch(
  ideaJobId: string,
  ideaId: string,
  deepSearchJobId: string,
): void {
  const result = db
    .update(ideaRecords)
    .set({ deepSearchJobId })
    .where(
      and(
        eq(ideaRecords.ideaId, ideaId),
        eq(ideaRecords.ideaJobId, ideaJobId),
        eq(ideaRecords.selected, true),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Refined idea was not found")
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
    ideaJobId: input.ideaJobId,
    ideaJobPosition: input.deepSearchCount + idea.position,
    maxRetries: input.maxRetries,
  })
  try {
    attachIdeaDeepSearch(input.ideaJobId, idea.ideaId, search.deepSearchJobId)
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

    stage = "critique"
    const critiquedIdeas = await critiqueIdeas(input, summary, persistedIdeas)

    stage = "selection"
    const selectedIdeas = await selectIdeas(input, summary, critiquedIdeas)

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
            stage === "critique" ||
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
