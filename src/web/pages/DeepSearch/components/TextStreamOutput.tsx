import ExpandMore from "@mui/icons-material/ExpandMore"
import { Button, Collapse, Stack, Typography } from "@mui/material"
import { useId, useState } from "react"
import type { TextStreamState } from "../useTextStream.ts"

type TextStreamOutputProps = {
  stream: TextStreamState
  waitingText: string
  textTestId: string
}

type StreamTextProps = {
  stream: TextStreamState
  waitingText: string
  textTestId: string
}

function StreamText({ stream, waitingText, textTestId }: StreamTextProps) {
  if (stream.status === "error") {
    return (
      <Typography variant="body2" color="error">
        {stream.message}
      </Typography>
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

  return (
    <Stack spacing={0.5}>
      <Button
        size="small"
        color="inherit"
        endIcon={
          <ExpandMore
            sx={{
              transform: expanded ? "rotate(180deg)" : undefined,
              transition: "transform 150ms ease",
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
      <Collapse in={expanded} unmountOnExit>
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

/** Renders user-facing output with persisted reasoning collapsed by default. */
export function TextStreamOutput({
  stream,
  waitingText,
  textTestId,
}: TextStreamOutputProps) {
  return (
    <Stack spacing={1.5}>
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
