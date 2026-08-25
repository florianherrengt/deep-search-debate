import z from "zod"
import { postJson } from "./api.ts"
import type { ResearchWorkflowKind } from "./researchCancellation.ts"

const researchResumeResponseSchema = z.object({
  status: z.literal("running"),
})

const collectionByKind = {
  "deep-search": "deep-search-jobs",
  idea: "idea-jobs",
  debate: "debate-jobs",
} as const satisfies Record<ResearchWorkflowKind, string>

export type ResearchResumeResponse = z.output<
  typeof researchResumeResponseSchema
>

/** Shared typed browser boundary for the root Resume endpoints. */
export async function requestResearchResume(
  kind: ResearchWorkflowKind,
  jobId: string,
  signal?: AbortSignal,
): Promise<ResearchResumeResponse> {
  return postJson(
    `/api/${collectionByKind[kind]}/${encodeURIComponent(jobId)}/resume`,
    {},
    researchResumeResponseSchema,
    signal,
  )
}
