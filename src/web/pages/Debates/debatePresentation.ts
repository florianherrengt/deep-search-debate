import type { DebateStage, DebateTournament } from "./debateUiTypes.ts"

export const debateStatusPresentation = {
  running: { label: "Debate in progress", color: "primary" },
  completed: { label: "Debate complete", color: "success" },
  failed: { label: "Debate failed", color: "error" },
  interrupted: { label: "Debate interrupted", color: "warning" },
} as const satisfies Record<
  DebateTournament["status"],
  {
    label: string
    color: "primary" | "success" | "error" | "warning"
  }
>

export const debateStageLabels = {
  ideas: "Building ideas",
  swiss: "Debate rounds",
  semifinal: "Knockout round",
  final: "Final",
} as const satisfies Record<DebateStage, string>
