import { Chip } from "@mui/material"

type JobStatus = "running" | "completed" | "failed" | "interrupted"

const statusPresentation = {
  running: { label: "Running", color: "primary" },
  completed: { label: "Complete", color: "success" },
  failed: { label: "Failed", color: "error" },
  interrupted: { label: "Interrupted", color: "warning" },
} as const satisfies Record<
  JobStatus,
  {
    label: string
    color: "primary" | "success" | "error" | "warning"
  }
>

export function JobStatusBadge({
  status,
  stopRequested = false,
}: {
  status: JobStatus
  stopRequested?: boolean
}) {
  const presentation =
    status === "running" && stopRequested
      ? { label: "Stopping…", color: "warning" as const }
      : status === "interrupted" && stopRequested
        ? { label: "Stopped", color: "warning" as const }
        : statusPresentation[status]

  return (
    <Chip
      color={presentation.color}
      label={presentation.label}
      size="small"
      sx={{ flexShrink: 0 }}
      variant="outlined"
    />
  )
}
