import { and, eq, inArray, isNull } from "drizzle-orm"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
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

export function ideaSiteScreenshotPath(ideaId: string): string {
  return join(config.ideaSites.dir, ideaId, "websites", "screenshot.png")
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
  await captureIdeaSiteScreenshotBestEffort(input.idea.ideaId)
}


/** Persists one generated idea website as a single self-contained page. */
export async function writeIdeaSite(
  ideaId: string,
  html: string,
): Promise<void> {
  await writeFileAtomically(ideaSitePath(ideaId), Buffer.from(html, "utf-8"))
}

/** Renders the stored page headlessly and stores one square PNG preview. */
async function captureIdeaSiteScreenshot(ideaId: string): Promise<void> {
  // Imported lazily so API startup never pays for the browser toolchain and
  // deployments without a usable Chromium keep serving.
  const { default: puppeteer } = await import("puppeteer")
  // Container runtimes typically forbid Chromium's namespace sandbox; the
  // page is our own generated file opened in a throwaway clean profile.
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ height: 1024, width: 1024 })
    await page.goto(pathToFileURL(ideaSitePath(ideaId)).href, {
      timeout: 30_000,
      waitUntil: "load",
    })
    const png = await page.screenshot({ type: "png" })
    await writeFileAtomically(ideaSiteScreenshotPath(ideaId), png)
  } finally {
    await browser.close()
  }
}

async function captureIdeaSiteScreenshotBestEffort(ideaId: string): Promise<void> {
  try {
    await captureIdeaSiteScreenshot(ideaId)
  } catch (error) {
    // The preview is presentation-only: a headless-browser failure must not
    // fail the workflow that already persisted its website.
    console.warn(`Idea site screenshot for ${ideaId} failed`, error)
  }
}

async function writeFileAtomically(
  path: string,
  data: Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Readers must never observe a torn file while a regeneration is in flight.
  const tempPath = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tempPath, data)
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

/** Returns the stored screenshot bytes, or undefined when none was captured. */
export async function readIdeaSiteScreenshot(
  ideaId: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    // Copied into a fresh ArrayBuffer so the bytes can back an HTTP response.
    return new Uint8Array(await readFile(ideaSiteScreenshotPath(ideaId)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
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

  const debate = db
    .select({ websiteGenerationId: debateJobs.websiteGenerationId })
    .from(debateJobs)
    .where(eq(debateJobs.debateJobId, input.debateJobId))
    .get()
  if (!debate) throw new Error("Debate job was not found")
  const existingWebsiteGeneration = debate.websiteGenerationId === null
    ? null
    : db
        .select({
          generationId: llmGenerations.llmGenerationId,
          status: llmGenerations.status,
          text: llmGenerations.text,
        })
        .from(llmGenerations)
        .where(
          and(
            eq(
              llmGenerations.llmGenerationId,
              debate.websiteGenerationId,
            ),
            eq(llmGenerations.debateJobId, input.debateJobId),
          ),
        )
        .get()
  if (debate.websiteGenerationId !== null && !existingWebsiteGeneration) {
    throw new Error("Linked winner website generation was not found")
  }
  if (existingWebsiteGeneration?.status === "completed") {
    if (existingWebsiteGeneration.text === null) {
      throw new Error("Completed winner website generation has no HTML")
    }
    if ((await readIdeaSite(input.winnerIdeaId)) === undefined) {
      await writeIdeaSite(input.winnerIdeaId, existingWebsiteGeneration.text)
    }
    if ((await readIdeaSiteScreenshot(input.winnerIdeaId)) === undefined) {
      await captureIdeaSiteScreenshotBestEffort(input.winnerIdeaId)
    }
    return
  }
  const replacedGenerationId = existingWebsiteGeneration?.generationId

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
      if (replacedGenerationId !== undefined) {
        const currentLink = transaction
          .select({ id: debateJobs.debateJobId })
          .from(debateJobs)
          .where(
            and(
              eq(debateJobs.debateJobId, input.debateJobId),
              eq(debateJobs.websiteGenerationId, replacedGenerationId),
            ),
          )
          .get()
        if (!currentLink) {
          throw new Error("The winner website generation link changed")
        }
        const retryableAttempt = transaction
          .select({ status: llmGenerations.status })
          .from(llmGenerations)
          .where(
            and(
              eq(llmGenerations.llmGenerationId, replacedGenerationId),
              eq(llmGenerations.debateJobId, input.debateJobId),
              inArray(llmGenerations.status, [
                "running",
                "failed",
                "interrupted",
              ]),
            ),
          )
          .get()
        if (!retryableAttempt) {
          throw new Error("The replaced website generation is not retryable")
        }
        if (retryableAttempt.status === "running") {
          const interruption = transaction
            .update(llmGenerations)
            .set({
              status: "interrupted",
              error: "Interrupted by a server restart",
              completedAt: new Date(),
            })
            .where(
              and(
                eq(llmGenerations.llmGenerationId, replacedGenerationId),
                eq(llmGenerations.status, "running"),
              ),
            )
            .run()
          if (interruption.changes !== 1) {
            throw new Error("The stale website generation status changed")
          }
        }
      }
      const result = transaction
        .update(debateJobs)
        .set({ websiteGenerationId: generationId })
        .where(
          and(
            eq(debateJobs.debateJobId, input.debateJobId),
            replacedGenerationId === undefined
              ? isNull(debateJobs.websiteGenerationId)
              : eq(
                  debateJobs.websiteGenerationId,
                  replacedGenerationId,
                ),
          ),
        )
        .run()
      if (result.changes !== 1) {
        throw new Error("The winner website generation link changed")
      }
    },
  })
}
