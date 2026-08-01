import { Stack, Typography } from "@mui/material"
import {
  useTextStream,
  type TextStreamState,
} from "../useTextStream.ts"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

type SelectionOutputProps = {
  query: string
  streamId?: string
}

function getSelectionLabel(status: TextStreamState["status"]): string {
  if (status === "streaming") return "Selecting results…"
  return "Selection output"
}

export function SelectionOutput({ query, streamId }: SelectionOutputProps) {
  const stream = useTextStream(streamId)
  if (!streamId) return null

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" color="text.secondary">
        {getSelectionLabel(stream.status)}
      </Typography>
      <TextStreamOutput
        stream={stream}
        waitingText="Waiting for selection…"
        reasoningTestId={`selection-reasoning-${query}`}
        textTestId={`selection-stream-${query}`}
      />
    </Stack>
  )
}
