export const PROMPT_EXCERPT_MAX_LENGTH = 180

export function getPromptExcerpt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim()
  if (normalized.length <= PROMPT_EXCERPT_MAX_LENGTH) return normalized
  return `${normalized.slice(0, PROMPT_EXCERPT_MAX_LENGTH - 1).trimEnd()}…`
}
