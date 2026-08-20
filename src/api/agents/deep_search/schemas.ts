import z from "zod"
import { secureJsonParse } from "@ai-sdk/provider-utils"

type DeepSearchResult = {
  title: string
  shortText: string
  link: string
}

export type DeepSearchSearch = {
  query: string
  results: DeepSearchResult[]
}

type DeepSearchSearchResults = DeepSearchSearch[]

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
})

export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>

export function parseResearchAnalysisText(text: string): ResearchAnalysis {
  return researchAnalysisSchema.parse(secureJsonParse(text))
}

export type DeepSearchEvent =
  | { type: "query-stream"; round: number; streamId: string }
  | { type: "search-results"; round: number; searches: DeepSearchSearchResults }
  | { type: "selection-stream"; round: number; query: string; streamId: string }
  | {
      type: "selected-search-results"
      round: number
      query: string
      selectedLinks: string[]
    }
  | { type: "page-summary-stream"; url: string; streamId: string }
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
