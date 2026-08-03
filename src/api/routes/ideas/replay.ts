import { asc, eq } from "drizzle-orm"
import z from "zod"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
} from "../../db/schema/index.ts"
import { ideaSchema, type IdeaJobEvent } from "./schemas.ts"

const ideaGenerationOutputSchema = z.object({
  elements: z.array(ideaSchema),
})

function replayIdeas(generationId: string | null): IdeaJobEvent[] {
  if (!generationId) return []
  const generation = db
    .select({ text: llmGenerations.text })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, generationId))
    .get()
  if (!generation?.text) return []

  try {
    // Ideas intentionally have no table of their own. The structured array in
    // the linked LLM generation is their canonical durable representation.
    // AI SDK Output.array persists that array inside an `elements` envelope.
    const { elements } = ideaGenerationOutputSchema.parse(
      JSON.parse(generation.text),
    )
    return elements.map((idea) => ({ type: "idea", ...idea }))
  } catch {
    // Deliberate tradeoff: failed/interrupted generations may contain an
    // incomplete JSON envelope, so idea cards emitted before that failure are
    // not recovered after restart. If that becomes required, use the AI SDK's
    // parsePartialJson and validate each recovered element with ideaSchema.
    return []
  }
}

/** Reconstructs parent progress; nested deep-search details replay independently. */
export function reconstructIdeaJobEvents(
  ideaJobId: string,
): IdeaJobEvent[] | undefined {
  const job = db
    .select()
    .from(ideaJobs)
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .get()
  if (!job) return

  // The parent stores no duplicated child progress. It only re-emits the child
  // IDs; each nested deep-search subscription reconstructs its detailed events.
  const searches = db
    .select({
      deepSearchJobId: deepSearchJobs.deepSearchJobId,
      researchRequest: deepSearchJobs.researchRequest,
    })
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
    .orderBy(asc(deepSearchJobs.createdAt))
    .all()

  return [
    ...(job.researchPromptGenerationId
      ? [
          {
            type: "research-prompt-stream" as const,
            streamId: job.researchPromptGenerationId,
          },
        ]
      : []),
    ...searches.map((search) => ({
      type: "deep-search-started" as const,
      ...search,
    })),
    ...(job.researchSummaryGenerationId
      ? [
          {
            type: "research-summary-stream" as const,
            streamId: job.researchSummaryGenerationId,
          },
        ]
      : []),
    ...(job.ideaGenerationId
      ? [
          {
            type: "idea-generation-stream" as const,
            streamId: job.ideaGenerationId,
          },
        ]
      : []),
    ...replayIdeas(job.ideaGenerationId),
    ...(job.status === "running"
      ? []
      : [
          ...(job.error
            ? [
                {
                  type: "error" as const,
                  message: job.error,
                  stage: job.stage,
                },
              ]
            : []),
          { type: "done" as const },
        ]),
  ]
}
