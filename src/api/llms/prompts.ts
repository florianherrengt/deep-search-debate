import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const promptsDir = resolve(__dirname, "prompts")

/** @public */
export const PromptName = {
  AnalyzeResearchAnswer: "analyze-research-answer",
  AnswerResearchRequest: "answer-research-request",
  BrowserAgentAction: "browser-agent-action",
  CorrectResearchAnswer: "correct-research-answer",
  CreateIdeaSite: "create-idea-site",
  DebateJudge: "debate-judge",
  DebateOpening: "debate-opening",
  DebateRebuttal: "debate-rebuttal",
  EvaluateIdea: "evaluate-idea",
  RefineIdea: "refine-idea",
  RefineGenerateQuestions: "refine-generate-questions",
  RefineCondenseResearchRequest: "refine-condense-research-request",
  Default: "default",
  GeneratePromptTitle: "generate-prompt-title",
  GenerateWebSearchQueries: "generate-websearch-queries",
  GenerateDiscoveryQueries: "generate-discovery-queries",
  SelectDiscoveryResults: "select-discovery-results",
  SelectDiscoveryLinks: "select-discovery-links",
  SummarizeDiscoveryPage: "summarize-discovery-page",
  SummarizeDiscoveryQuery: "summarize-discovery-query",
  UpdateDiscoveryInventory: "update-discovery-inventory",
  ReviewDiscoveryRound: "review-discovery-round",
  ReviewDeepSearchRound: "review-deep-search-round",
  GenerateIdeaResearchPrompts: "generate-idea-research-prompts",
  GenerateIdeas: "generate-ideas",
  SelectIdeas: "select-ideas",
  SelectWebSearchResults: "select-websearch-results",
  SelectLinkedPages: "select-linked-pages",
  SummarizeIdeaResearch: "summarize-idea-research",
  SummarizeSearchQuery: "summarize-search-query",
  SummarizeWebPage: "summarize-web-page",
} as const
export type PromptName = (typeof PromptName)[keyof typeof PromptName]

const promptStageLabels: Record<PromptName, string> = {
  "analyze-research-answer": "Research analysis",
  "answer-research-request": "Research answer generation",
  "browser-agent-action": "Browser action selection",
  "correct-research-answer": "Final answer correction",
  "create-idea-site": "Idea website generation",
  "debate-judge": "Debate judgment",
  "debate-opening": "Debate opening",
  "debate-rebuttal": "Debate rebuttal",
  "evaluate-idea": "Idea evaluation",
  "refine-idea": "Idea refinement",
  "refine-generate-questions": "Clarification question generation",
  "refine-condense-research-request": "Research request preparation",
  "default": "Text generation",
  "generate-prompt-title": "Title generation",
  "generate-websearch-queries": "Research planning",
  "generate-discovery-queries": "Discovery planning",
  "select-discovery-results": "Discovery result selection",
  "select-discovery-links": "Linked-source selection",
  "summarize-discovery-page": "Discovery page summary",
  "summarize-discovery-query": "Discovery search summary",
  "update-discovery-inventory": "Discovery inventory update",
  "review-discovery-round": "Discovery review",
  "review-deep-search-round": "Research review",
  "generate-idea-research-prompts": "Idea research planning",
  "generate-ideas": "Idea generation",
  "select-ideas": "Idea selection",
  "select-websearch-results": "Search result selection",
  "select-linked-pages": "Linked-source selection",
  "summarize-idea-research": "Idea research summary",
  "summarize-search-query": "Search summary",
  "summarize-web-page": "Page summary",
}

export function getPromptStageLabel(promptName: string): string {
  return Object.hasOwn(promptStageLabels, promptName)
    ? promptStageLabels[promptName as PromptName]
    : "Text generation"
}

export async function loadPrompt(name: PromptName): Promise<string> {
  const filePath = resolve(promptsDir, `${name}.md`)
  return readFile(filePath, "utf-8")
}
