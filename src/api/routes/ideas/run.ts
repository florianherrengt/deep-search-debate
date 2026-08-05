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
  type IdeaStage,
  type LiveIdeaJob,
} from "./schemas.ts"

type RunIdeaJobInput = {
  ideaJobId: string
  prompt: string
  numberOfIdeas: number
  deepSearchCount: number
  maxSearches: number
  maxResultsPerSearch: number
  maxRetries?: number
  job: LiveIdeaJob
  deepSearchManager: DeepSearchJobManager
}

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

function setStage(ideaJobId: string, stage: IdeaStage): void {
  db.update(ideaJobs)
    .set({ stage })
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .run()
}

async function generateResearchPrompts(
  input: RunIdeaJobInput,
): Promise<string[]> {
  const generation = await generateArrayStream({
    prompt: buildResearchPrompt(input.prompt, input.deepSearchCount),
    promptName: PromptName.GenerateIdeaResearchPrompts,
    element: z.string().trim().min(1),
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
  if (new Set(prompts).size !== prompts.length) {
    throw new Error("Research prompts must be distinct")
  }
  return prompts
}

async function runResearch(
  input: RunIdeaJobInput,
  prompts: string[],
): Promise<string[]> {
  // start() launches immediately. Mapping every prompt before awaiting any
  // completion is what makes these durable child jobs run in parallel.
  const searches = prompts.map((researchRequest) => {
    const search = input.deepSearchManager.start({
      researchRequest,
      maxSearches: input.maxSearches,
      maxResultsPerSearch: input.maxResultsPerSearch,
      ideaJobId: input.ideaJobId,
      maxRetries: input.maxRetries,
    })
    input.job.publish({
      type: "deep-search-started",
      deepSearchJobId: search.deepSearchJobId,
      researchRequest,
    })
    return search
  })

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
  return settled.map((result) => (result as PromiseFulfilledResult<string>).value)
}

async function summarizeResearch(
  input: RunIdeaJobInput,
  research: string[],
): Promise<string> {
  // Only the child jobs' final answer texts enter this call. Their intermediate
  // pages and source records remain available through the nested job views.
  const generation = await generateTextStream({
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

async function publishIdeas(
  elements: AsyncIterable<Idea>,
  job: LiveIdeaJob,
): Promise<void> {
  // elementStream emits complete schema-validated objects, allowing the UI to
  // render each idea without waiting for the complete array.
  for await (const idea of elements) job.publish({ type: "idea", ...idea })
}

async function generateIdeas(
  input: RunIdeaJobInput,
  researchSummary: string,
): Promise<Idea[]> {
  const generation = await generateArrayStream({
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

  // Consume all three representations concurrently:
  // - output validates and returns the complete array;
  // - collectStreamText retains raw JSON and reasoning for replay/debugging;
  // - elementStream publishes individual idea cards as soon as they validate.
  const [ideas] = await Promise.all([
    generation.output,
    collectStreamText({ id: generation.id }),
    publishIdeas(generation.elementStream, input.job),
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

/** Runs the all-or-nothing idea pipeline and publishes parent progress. */
export async function runIdeaJob(input: RunIdeaJobInput): Promise<void> {
  let stage: IdeaStage = "planning"
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

    db.transaction((transaction) => {
      transaction
        .insert(ideaRecords)
        .values(
          generatedIdeas.map((idea, position) => ({
            ideaId: crypto.randomUUID(),
            ideaJobId: input.ideaJobId,
            position,
            ...idea,
          })),
        )
        .run()
      transaction
        .update(ideaJobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(ideaJobs.ideaJobId, input.ideaJobId))
        .run()
    })
  } catch (error) {
    const message = getErrorMessage(error, "Idea generation failed")
    try {
      db.update(ideaJobs)
        .set({
          stage,
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
