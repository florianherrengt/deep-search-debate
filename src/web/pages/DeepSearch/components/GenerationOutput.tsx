import { Paper, Stack, Typography } from "@mui/material"
import { useTextStream } from "../useTextStream.ts"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

type GenerationOutputProps = {
  streamId: string
  title: string
  waitingText: string
  testId: string
}

/** Displays one retained model-generation stream. */
export function GenerationOutput({
  streamId,
  title,
  waitingText,
  testId,
}: GenerationOutputProps) {
  const stream = useTextStream(streamId)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography component="h3" variant="subtitle1">
          {title}
        </Typography>
        <TextStreamOutput
          stream={stream}
          waitingText={waitingText}
          textTestId={testId}
        />
      </Stack>
    </Paper>
  )
}
