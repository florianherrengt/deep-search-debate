import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const promptsDir = resolve(__dirname, "prompts")

/** @public */
export const PromptName = {
  AnalyzeResearchAnswer: "analyze-research-answer",
  AnswerResearchRequest: "answer-research-request",
  DebateJudge: "debate-judge",
  DebateOpening: "debate-opening",
  DebateRebuttal: "debate-rebuttal",
  EvaluateIdea: "evaluate-idea",
  RefineIdea: "refine-idea",
  Default: "default",
  GeneratePromptTitle: "generate-prompt-title",
  GenerateWebSearchQueries: "generate-websearch-queries",
  ReviewDeepSearchRound: "review-deep-search-round",
  GenerateIdeaResearchPrompts: "generate-idea-research-prompts",
  GenerateIdeas: "generate-ideas",
  SelectIdeas: "select-ideas",
  SelectWebSearchResults: "select-websearch-results",
  SummarizeIdeaResearch: "summarize-idea-research",
  SummarizeSearchQuery: "summarize-search-query",
  SummarizeWebPage: "summarize-web-page",
} as const
export type PromptName = (typeof PromptName)[keyof typeof PromptName]

export async function loadPrompt(name: PromptName): Promise<string> {
  const filePath = resolve(promptsDir, `${name}.md`)
  return readFile(filePath, "utf-8")
}
