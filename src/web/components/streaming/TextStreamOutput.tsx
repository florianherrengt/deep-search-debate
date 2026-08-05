import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Button,
  Collapse,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material"
import { useId, useState } from "react"
import type { TextStreamState } from "./useTextStream.ts"

type TextStreamOutputProps = {
  stream: TextStreamState
  waitingText: string
  textTestId: string
  announcementLabel?: string
}

function getAnnouncement(status: TextStreamState["status"]): string {
  switch (status) {
    case "idle":
      return "Waiting for response"
    case "streaming":
      return "Response streaming"
    case "reconnecting":
      return "Response interrupted; reconnecting"
    case "completed":
      return "Response complete"
    case "error":
      return "Response unavailable"
  }
}

function StreamText({
  stream,
  waitingText,
  textTestId,
}: TextStreamOutputProps) {
  if (stream.status === "error" || stream.status === "reconnecting") {
    return (
      <Stack spacing={1}>
        <Typography
          color={stream.status === "error" ? "error" : "warning.main"}
          role={stream.status === "error" ? "alert" : undefined}
          variant="body2"
        >
          {stream.message}
        </Typography>
        {stream.text && (
          <Typography
            data-testid={textTestId}
            sx={{ whiteSpace: "pre-wrap" }}
            variant="body2"
          >
            {stream.text}
          </Typography>
        )}
      </Stack>
    )
  }

  return (
    <Typography
      data-testid={textTestId}
      variant="body2"
      sx={{ whiteSpace: "pre-wrap" }}
    >
      {stream.text || waitingText}
    </Typography>
  )
}

function StreamReasoning({
  reasoning,
  textTestId,
}: {
  reasoning: string
  textTestId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)")

  return (
    <Stack spacing={0.5}>
      <Button
        size="small"
        color="inherit"
        endIcon={
          <ExpandMore
            sx={{
              transform: expanded ? "rotate(180deg)" : undefined,
            }}
          />
        }
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
        sx={{ alignSelf: "flex-start", px: 0.5 }}
      >
        {expanded ? "Hide reasoning" : "Show reasoning"}
      </Button>
      <Collapse
        data-testid={`${textTestId}-reasoning-collapse`}
        in={expanded}
        timeout={reduceMotion ? 0 : "auto"}
        unmountOnExit
      >
        <Typography
          id={contentId}
          data-testid={`${textTestId}-reasoning`}
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap" }}
        >
          {reasoning}
        </Typography>
      </Collapse>
    </Stack>
  )
}

/** Renders retained output with an optional contextual status announcement. */
export function TextStreamOutput({
  stream,
  waitingText,
  textTestId,
  announcementLabel,
}: TextStreamOutputProps) {
  return (
    <Stack spacing={1.5}>
      {announcementLabel && (
        <Typography
          aria-atomic="true"
          aria-live="polite"
          component="span"
          role="status"
          sx={{
            border: 0,
            clip: "rect(0 0 0 0)",
            height: 1,
            margin: -1,
            overflow: "hidden",
            padding: 0,
            position: "absolute",
            whiteSpace: "nowrap",
            width: 1,
          }}
        >
          {announcementLabel}: {getAnnouncement(stream.status)}
        </Typography>
      )}
      {stream.reasoning && (
        <StreamReasoning
          reasoning={stream.reasoning}
          textTestId={textTestId}
        />
      )}
      <StreamText
        stream={stream}
        waitingText={waitingText}
        textTestId={textTestId}
      />
    </Stack>
  )
}
