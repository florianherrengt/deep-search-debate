import { Stack, Typography } from "@mui/material"
import type { TextStreamState } from "../useTextStream.ts"

type TextStreamOutputProps = {
  stream: TextStreamState
  waitingText: string
  reasoningTestId: string
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

  if (!stream.text && stream.reasoning) return null

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

/** Renders reasoning, generated text, and failures from one text stream. */
export function TextStreamOutput({
  stream,
  waitingText,
  reasoningTestId,
  textTestId,
}: TextStreamOutputProps) {
  return (
    <Stack spacing={1}>
      {stream.reasoning && (
        <Typography
          data-testid={reasoningTestId}
          variant="body2"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap" }}
        >
          {stream.reasoning}
        </Typography>
      )}

      <StreamText
        stream={stream}
        waitingText={waitingText}
        textTestId={textTestId}
      />
    </Stack>
  )
}
