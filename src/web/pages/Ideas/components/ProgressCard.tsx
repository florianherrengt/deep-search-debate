import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Stack,
  Typography,
} from "@mui/material"
import {
  type FocusEventHandler,
  type ReactNode,
  useState,
} from "react"

export type ProgressStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "not-run"

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
  "not-run": { label: "Not run", color: "default" },
}

export function ProgressCard({
  title,
  status,
  children,
  autoExpandStatuses = defaultAutoExpandStatuses,
  onBlurCapture,
  onFocusCapture,
}: {
  title: string
  status: ProgressStatus
  children: ReactNode
  autoExpandStatuses?: ProgressStatus[]
  onBlurCapture?: FocusEventHandler<HTMLDivElement>
  onFocusCapture?: FocusEventHandler<HTMLDivElement>
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)

  // Once someone opens or closes a stage, keep that choice as its status
  // changes so streaming updates do not move the content out from under them.
  const expanded = manualExpanded ?? autoExpandStatuses.includes(status)
  const presentation = statusPresentation[status]

  return (
    <Accordion
      expanded={expanded}
      onBlurCapture={onBlurCapture}
      onChange={(_event, next) => setManualExpanded(next)}
      onFocusCapture={onFocusCapture}
      slots={{ heading: "h3" }}
      disableGutters
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", width: "100%" }}
        >
          <Typography component="span" variant="subtitle1" sx={{ flexGrow: 1 }}>
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
      <AccordionDetails>
        {status === "not-run" ? (
          <Typography color="text.secondary">
            This stage did not run because an earlier stage failed.
          </Typography>
        ) : (
          children
        )}
      </AccordionDetails>
    </Accordion>
  )
}
