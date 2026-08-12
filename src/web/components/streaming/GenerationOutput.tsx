import { Paper, Stack, Typography } from "@mui/material"
import type { ReactNode } from "react"
import { TextStreamOutput } from "./TextStreamOutput.tsx"
import type { StreamTextFormat } from "./FormattedStreamText.tsx"
import { useTextStream } from "./useTextStream.ts"

type GenerationOutputProps = {
  streamId: string
  title: string
  waitingText: string
  testId: string
  headingComponent: "h2" | "h3" | "h4" | "h5" | "h6"
  announcementLabel?: string
  format?: StreamTextFormat
  showText?: boolean
  children?: ReactNode
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
  showText,
  children,
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
          showText={showText}
          waitingText={waitingText}
          textTestId={testId}
        />
        {children}
      </Stack>
    </Paper>
  )
}
