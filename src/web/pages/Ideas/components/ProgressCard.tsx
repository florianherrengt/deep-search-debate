import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Stack,
  Typography,
} from "@mui/material"
import { type ReactNode, useState } from "react"

export type ProgressStatus = "waiting" | "running" | "completed" | "failed"

const defaultAutoExpandStatuses: ProgressStatus[] = ["running"]

const statusPresentation: Record<
  ProgressStatus,
  {
    label: string
    color: "default" | "primary" | "success" | "error"
  }
> = {
  waiting: { label: "Waiting", color: "default" },
  running: { label: "Running", color: "primary" },
  completed: { label: "Complete", color: "success" },
  failed: { label: "Failed", color: "error" },
}

export function ProgressCard({
  title,
  status,
  children,
  autoExpandStatuses = defaultAutoExpandStatuses,
}: {
  title: string
  status: ProgressStatus
  children: ReactNode
  autoExpandStatuses?: ProgressStatus[]
}) {
  const [manualState, setManualState] = useState<{
    status: ProgressStatus
    expanded: boolean
  } | null>(null)

  // A manual choice applies only during the current stage status.
  // When the stage changes status, the new key ignores that
  // stale choice and automatically expands or collapses the card once.
  const expanded =
    manualState?.status === status
      ? manualState.expanded
      : autoExpandStatuses.includes(status)
  const presentation = statusPresentation[status]

  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, next) => setManualState({ status, expanded: next })}
      variant="outlined"
      disableGutters
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", width: "100%" }}
        >
          <Typography component="h2" variant="subtitle1" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          <Chip
            size="small"
            label={presentation.label}
            color={presentation.color}
            variant="outlined"
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  )
}
