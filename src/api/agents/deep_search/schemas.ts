import z from "zod"
import { secureJsonParse } from "../../helpers/secureJsonParse.ts"

type DeepSearchResult = {
  title: string
  shortText: string
  link: string
}

export type DeepSearchSearch = {
  query: string
  results: DeepSearchResult[]
}

export const pageLinkSelectionSchema = z.object({
  selectedIds: z.array(z.string().trim().min(1)),
}).refine(({ selectedIds }) => new Set(selectedIds).size === selectedIds.length,
  "Selected link IDs must be unique")

type DeepSearchSearchResults = DeepSearchSearch[]

export const researchRequirementsSchema = z.array(z.object({
  requirement: z.string().trim().min(1).max(500),
  kind: z.enum(["requirement", "preference"]),
  status: z.enum(["unresolved", "supported", "conflicting"]),
  sources: z.array(z.url({ protocol: /^https?$/ })).max(8),
  explanation: z.string().trim().min(1).max(1_000),
})).max(12)
export type ResearchRequirements = z.infer<typeof researchRequirementsSchema>

/** Version 1 adds structured requirements to the formerly query-only plan. */
export const researchPlanSchema = z.object({
  version: z.literal(1),
  requirements: researchRequirementsSchema,
  queries: z.array(z.string().trim().min(1).max(500)).min(1),
})

export function parseResearchPlan(text: string): {
  version: 1 | undefined
  requirements: ResearchRequirements
  queries: string[]
} {
  const value = secureJsonParse(text)
  const legacyQueries: unknown = Array.isArray(value) ? value :
    value !== null && typeof value === "object" && !("version" in value) && "elements" in value
      ? value.elements : undefined
  if (legacyQueries !== undefined) {
    // generateArrayStream persisted an elements wrapper; earlier checkpoints
    // also used bare arrays. Neither legacy format contains a checklist.
    return { version: undefined, requirements: [], queries: z.array(z.string().trim().min(1).max(500)).parse(legacyQueries) }
  }
  return researchPlanSchema.parse(value)
}

const sourcedResearchAnalysisItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  sources: z.array(z.url({ protocol: /^https?$/ })).max(12),
})

const researchGapSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
})

export const researchAnalysisSchema = z.object({
  facts: z.array(sourcedResearchAnalysisItemSchema).max(12),
  disagreements: z.array(sourcedResearchAnalysisItemSchema).max(12),
  gaps: z.array(researchGapSchema).max(12),
  assumptions: z.array(sourcedResearchAnalysisItemSchema).max(12),
  requirements: researchRequirementsSchema.optional(),
})

export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>

export function parseResearchAnalysisText(text: string): ResearchAnalysis {
  return researchAnalysisSchema.parse(secureJsonParse(text))
}

export type DeepSearchEvent =
  | { type: "query-stream"; round: number; streamId: string }
  | { type: "research-requirements"; round: number; requirements: ResearchRequirements }
  | { type: "search-results"; round: number; searches: DeepSearchSearchResults }
  | { type: "selection-stream"; round: number; query: string; streamId: string }
  | {
      type: "selected-search-results"
      round: number
      query: string
      selectedLinks: string[]
    }
  | { type: "page-summary-stream"; url: string; streamId: string }
  | { type: "linked-page-selection-stream"; sourceUrl: string; streamId: string }
  | {
      type: "selected-linked-pages"
      sourceUrl: string
      links: Array<{ url: string; title: string }>
    }
  | {
      type: "page-summary-error"
      url: string
      stage: "extraction" | "summary"
      message: string
    }
  | {
      type: "query-summary-stream"
      round: number
      query: string
      streamId: string
    }
  | { type: "round-answer-stream"; round: number; streamId: string }
  | { type: "round-review-stream"; round: number; streamId: string }
  | {
      type: "round-review"
      round: number
      decision: "continue" | "stop"
      reason: string
    }
  | { type: "round-review-error"; round: number; message: string }
  | { type: "final-answer-stream"; streamId: string }
  | { type: "research-analysis"; analysis: ResearchAnalysis }
