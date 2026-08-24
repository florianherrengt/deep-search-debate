import "dotenv/config"
import { eq } from "drizzle-orm"
import { resolve } from "node:path"
import z from "zod"
import { db } from "./db/index.ts"
import { ideaJobs, ideas, llmGenerations } from "./db/schema/index.ts"
import { generateIdeaSite, ideaSitePath } from "./routes/ideas/ideaSites.ts"

const usage =
  "Usage: node --experimental-strip-types cli.ts <command> <ideaId>\nCommands: --generate-idea-website"

async function generateIdeaWebsite(ideaId: string): Promise<void> {
  const idea = db.select().from(ideas).where(eq(ideas.ideaId, ideaId)).get()
  if (!idea) throw new Error(`Idea ${ideaId} was not found`)
  if (
    idea.selected !== true ||
    idea.refinedTitle === null ||
    idea.refinedDescription === null
  ) {
    throw new Error(
      `Idea ${ideaId} is not a selected idea with a refined title and description`,
    )
  }
  const job = db
    .select()
    .from(ideaJobs)
    .where(eq(ideaJobs.ideaJobId, idea.ideaJobId))
    .get()
  if (!job?.researchSummaryGenerationId) {
    throw new Error(
      `Idea job ${idea.ideaJobId} has no research summary generation`,
    )
  }
  const summary = db
    .select()
    .from(llmGenerations)
    .where(
      eq(llmGenerations.llmGenerationId, job.researchSummaryGenerationId),
    )
    .get()
  if (!summary || summary.status !== "completed" || summary.text === null) {
    throw new Error(
      `Research summary generation ${job.researchSummaryGenerationId} of idea job ${idea.ideaJobId} did not complete`,
    )
  }

  await generateIdeaSite({
    userId: job.userId,
    // The CLI regenerates ideas whose job is typically completed; a
    // job-owned generation would be rejected by the running-root guard.
    owner: { standalone: true },
    prompt: job.prompt,
    researchSummary: summary.text,
    idea: {
      ideaId,
      refinedTitle: idea.refinedTitle,
      refinedDescription: idea.refinedDescription,
    },
  })
  console.log(resolve(ideaSitePath(ideaId)))
}

const commands = {
  "--generate-idea-website": generateIdeaWebsite,
} as const

const argumentsSchema = z.tuple([
  z.enum(Object.keys(commands) as [keyof typeof commands]),
  z.uuid(),
])

async function main(): Promise<void> {
  const parsedArguments = argumentsSchema.safeParse(process.argv.slice(2))
  if (!parsedArguments.success) {
    throw new Error(
      `Expected a command and one idea UUID argument.\n${usage}`,
    )
  }
  const [command, ideaId] = parsedArguments.data
  await commands[command](ideaId)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
