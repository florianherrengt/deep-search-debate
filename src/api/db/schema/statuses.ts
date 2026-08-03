export const jobStatuses = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const

export const ideaJobStages = [
  "planning",
  "research",
  "summary",
  "ideas",
] as const

export const llmGenerationStatuses = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const

export const deepSearchQueryStatuses = [
  "pending",
  "searching",
  "selecting",
  "summarizing",
  "completed",
  "failed",
] as const

export const deepSearchQueryErrorStages = [
  "search",
  "selection",
  "summary",
] as const

export const deepSearchResultSelectionStatuses = [
  "pending",
  "selected",
  "rejected",
] as const

export const deepSearchWebPageStatuses = [
  "pending",
  "extracting",
  "summarizing",
  "completed",
  "failed",
] as const

export const deepSearchWebPageErrorStages = ["extraction", "summary"] as const
