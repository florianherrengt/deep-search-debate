import type { DebateStage, DebateTournament } from "./debateUiTypes.ts"

const debateStatusPresentation = {
  running: { label: "Debate in progress", color: "primary" },
  completed: { label: "Debate complete", color: "success" },
  failed: { label: "Debate failed", color: "error" },
  interrupted: { label: "Interrupted", color: "warning" },
} as const satisfies Record<
  DebateTournament["status"],
  {
    label: string
    color: "primary" | "success" | "error" | "warning"
  }
>

export function getDebateStatusPresentation(
  status: DebateTournament["status"],
  stopRequested: boolean,
) {
  if (status === "running" && stopRequested) {
    return { label: "Stopping…", color: "warning" as const }
  }
  if (status === "interrupted" && stopRequested) {
    return { label: "Stopped", color: "warning" as const }
  }
  return debateStatusPresentation[status]
}

export const debateStageLabels = {
  ideas: "Building ideas",
  swiss: "Debate rounds",
  semifinal: "Knockout round",
  final: "Final",
} as const satisfies Record<DebateStage, string>
