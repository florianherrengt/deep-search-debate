import z from "zod"
import { postJson } from "./api.ts"

const stopRequestedSchema = z.object({
  status: z.literal("cancellation-requested"),
  cancelRequestedAt: z.iso.datetime().transform((value) => new Date(value)),
})

const alreadyInterruptedSchema = z.object({
  status: z.literal("interrupted"),
  cancelRequestedAt: z.iso.datetime().transform((value) => new Date(value)),
  completedAt: z.iso.datetime().transform((value) => new Date(value)),
})

const researchStopResponseSchema = z.discriminatedUnion("status", [
  stopRequestedSchema,
  alreadyInterruptedSchema,
])

const collectionByKind = {
  "deep-search": "deep-search-jobs",
  idea: "idea-jobs",
  debate: "debate-jobs",
} as const

export type ResearchWorkflowKind = keyof typeof collectionByKind
export type ResearchStopResponse = z.output<typeof researchStopResponseSchema>

/** Shared typed browser boundary for the root Stop endpoints. */
export async function requestResearchStop(
  kind: ResearchWorkflowKind,
  jobId: string,
  signal?: AbortSignal,
): Promise<ResearchStopResponse> {
  return postJson(
    `/api/${collectionByKind[kind]}/${encodeURIComponent(jobId)}/cancel`,
    {},
    researchStopResponseSchema,
    signal,
  )
}
