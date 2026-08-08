import { eq } from "drizzle-orm"
import z from "zod"
import { db } from "../../db/index.ts"
import { ideaJobs, ideas as ideaRecords } from "../../db/schema/index.ts"
import { collectStreamText } from "../../helpers/collectStreamText.ts"
import { getErrorMessage } from "../../helpers/getErrorMessage.ts"
import {
  generateArrayStream,
  generateTextStream,
} from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import {
  ideaSchema,
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

function setGenerationId(
  ideaJobId: string,
  field:
    | "researchPromptGenerationId"
    | "researchSummaryGenerationId"
    | "ideaGenerationId",
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
  const searches = await Promise.all(
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
  for (const [index, search] of searches.entries()) {
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
  const settled = await Promise.allSettled(
    searches.map(({ completion }) => completion),
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
  for (const idea of ideas) input.job.publish({ type: "idea", ...idea })
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
): Promise<void> {
  const generation = await generateTextStream({
    userId: input.userId,
    owner: { ideaJobId: input.ideaJobId },
    prompt: buildCritiquePrompt(input.prompt, researchSummary, {
      title: idea.title,
      description: idea.description,
    }),
    promptName: PromptName.CritiqueIdea,
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
  await collectStreamText(generation)
}

async function critiqueIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
  ideas: PersistedIdea[],
): Promise<void> {
  // Start every independent critique immediately, but do not fail the parent
  // until all started generations have reached a terminal state.
  const settled = await Promise.allSettled(
    ideas.map((idea) => critiqueIdea(input, researchSummary, idea)),
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
    await critiqueIdeas(input, summary, persistedIdeas)

    db.update(ideaJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(ideaJobs.ideaJobId, input.ideaJobId))
      .run()
  } catch (error) {
    const message = getErrorMessage(error, "Idea generation failed")
    try {
      db.update(ideaJobs)
        .set({
          // Critique is an event subphase of the durable ideas stage. Keeping
          // the existing DB stage avoids rebuilding a heavily referenced
          // SQLite parent table merely to persist transient progress detail.
          stage: stage === "critique" ? "ideas" : stage,
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
