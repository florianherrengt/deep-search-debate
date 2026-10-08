import { getStoredLlmModelAssignments } from "../llms/modelSettings.ts"

export const modelSelectionRequiredError = {
  code: "model-selection-required",
  error: "Choose Small and Big models in Settings before starting.",
  redirectTo: "/settings#models",
} as const

export function needsModelSelection(userId: string): boolean {
  return getStoredLlmModelAssignments(userId) === undefined
}
