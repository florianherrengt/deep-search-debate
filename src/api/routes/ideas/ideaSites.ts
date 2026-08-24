import { and, eq, isNull } from "drizzle-orm"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import {
  debateJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationText,
  type LlmGenerationOwner,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"

export function ideaSitePath(ideaId: string): string {
  return join(config.ideaSites.dir, ideaId, "websites", "index.html")
}

function buildIdeaSitePrompt(
  prompt: string,
  researchSummary: string,
  idea: { refinedTitle: string; refinedDescription: string },
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
  ].join("\n")
}

export type IdeaSiteInput = {
  userId: string
  owner: LlmGenerationOwner
  prompt: string
  researchSummary: string
  idea: { ideaId: string; refinedTitle: string; refinedDescription: string }
  workflowSignal?: AbortSignal
  onRegistered?: (
    generationId: string,
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

/** Generates and stores one self-contained idea explainer page. */
export async function generateIdeaSite(
  input: IdeaSiteInput,
): Promise<void> {
  const generation = await generateTextStream({
    userId: input.userId,
    owner: input.owner,
    prompt: buildIdeaSitePrompt(
      input.prompt,
      input.researchSummary,
      input.idea,
    ),
    promptName: PromptName.CreateIdeaSite,
    // Hidden reasoning is disabled per the prose-output stage policy: at max
    // effort the model spends its whole budget thinking and emits no HTML.
    // The generous token bound only guards against runaway page size.
    reasoning: "disabled",
    maxOutputTokens: 65_536,
    workflowSignal: input.workflowSignal,
    onRegistered: input.onRegistered,
  })
  const html = await awaitGenerationText(generation)
  await writeIdeaSite(input.idea.ideaId, html)
}


/** Persists one generated idea website as a single self-contained page. */
export async function writeIdeaSite(
  ideaId: string,
  html: string,
): Promise<void> {
  const path = ideaSitePath(ideaId)
  await mkdir(dirname(path), { recursive: true })
  // Readers must never observe a torn page while a regeneration is in flight.
  const tempPath = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tempPath, html, "utf-8")
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

/** Returns the stored website, or undefined when it was never generated. */
export async function readIdeaSite(
  ideaId: string,
): Promise<string | undefined> {
  try {
    return await readFile(ideaSitePath(ideaId), "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}

/**
 * Generates the single website for a debate tournament's winning idea. The
 * debate is still running, so its generation is debate-owned and linked from
 * `debate_jobs.website_generation_id` inside the registration transaction.
 */
export async function generateWinningIdeaSite(input: {
  userId: string
  debateJobId: string
  winnerIdeaId: string
  workflowSignal?: AbortSignal
}): Promise<void> {
  const job = db
    .select({
      ideaJobId: ideaJobs.ideaJobId,
      prompt: ideaJobs.prompt,
      researchSummaryGenerationId: ideaJobs.researchSummaryGenerationId,
    })
    .from(ideaJobs)
    .where(eq(ideaJobs.debateJobId, input.debateJobId))
    .get()
  if (!job?.researchSummaryGenerationId) {
    throw new Error("Debate idea job has no research summary generation")
  }
  const idea = db
    .select({
      refinedTitle: ideas.refinedTitle,
      refinedDescription: ideas.refinedDescription,
    })
    .from(ideas)
    .where(
      and(
        eq(ideas.ideaId, input.winnerIdeaId),
        eq(ideas.ideaJobId, job.ideaJobId),
      ),
    )
    .get()
  if (
    !idea ||
    idea.refinedTitle === null ||
    idea.refinedDescription === null
  ) {
    throw new Error("Winning idea has no refined title and description")
  }
  const summary = db
    .select({ text: llmGenerations.text })
    .from(llmGenerations)
    .where(
      and(
        eq(llmGenerations.llmGenerationId, job.researchSummaryGenerationId),
        eq(llmGenerations.status, "completed"),
      ),
    )
    .get()
  if (!summary || summary.text === null) {
    throw new Error(
      "Research summary generation of the debate idea job did not complete",
    )
  }

  await generateIdeaSite({
    userId: input.userId,
    owner: { debateJobId: input.debateJobId },
    prompt: job.prompt,
    researchSummary: summary.text,
    idea: {
      ideaId: input.winnerIdeaId,
      refinedTitle: idea.refinedTitle,
      refinedDescription: idea.refinedDescription,
    },
    workflowSignal: input.workflowSignal,
    onRegistered: (generationId, transaction) => {
      const result = transaction
        .update(debateJobs)
        .set({ websiteGenerationId: generationId })
        .where(
          and(
            eq(debateJobs.debateJobId, input.debateJobId),
            isNull(debateJobs.websiteGenerationId),
          ),
        )
        .run()
      if (result.changes !== 1) throw new Error("Running debate was not found")
    },
  })
}
