import { Typography } from "@mui/material"
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

/** Renders only user-facing text and failures from one text stream. */
export function TextStreamOutput({
  stream,
  waitingText,
  textTestId,
}: TextStreamOutputProps) {
  return (
    <StreamText
      stream={stream}
      waitingText={waitingText}
      textTestId={textTestId}
    />
  )
}
