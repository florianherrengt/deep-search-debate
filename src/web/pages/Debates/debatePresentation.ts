import type { DebateStage, DebateTournament } from "./debateUiTypes.ts"

export const debateStatusPresentation = {
  running: { label: "Running automatically", color: "primary" },
  completed: { label: "Tournament complete", color: "success" },
  failed: { label: "Tournament failed", color: "error" },
  interrupted: { label: "Tournament interrupted", color: "warning" },
} as const satisfies Record<
  DebateTournament["status"],
  {
    label: string
    color: "primary" | "success" | "error" | "warning"
  }
>

export const debateStageLabels = {
  ideas: "Generating ideas",
  swiss: "Swiss stage",
  semifinal: "Semifinals",
  final: "Final",
} as const satisfies Record<DebateStage, string>
