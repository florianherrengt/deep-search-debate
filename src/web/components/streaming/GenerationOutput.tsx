import { Paper, Stack, Typography } from "@mui/material"
import { TextStreamOutput } from "./TextStreamOutput.tsx"
import type { StreamTextFormat } from "./FormattedStreamText.tsx"
import { useTextStream } from "./useTextStream.ts"

type GenerationOutputProps = {
  streamId: string
  title: string
  waitingText: string
  testId: string
  headingComponent: "h2" | "h3" | "h4"
  announcementLabel?: string
  format?: StreamTextFormat
}

/** Displays one retained model-generation stream. */
export function GenerationOutput({
  streamId,
  title,
  waitingText,
  testId,
  headingComponent,
  announcementLabel,
  format,
}: GenerationOutputProps) {
  const stream = useTextStream(streamId)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography component={headingComponent} variant="subtitle1">
          {title}
        </Typography>
        <TextStreamOutput
          announcementLabel={announcementLabel}
          format={format}
          stream={stream}
          waitingText={waitingText}
          textTestId={testId}
        />
      </Stack>
    </Paper>
  )
}
