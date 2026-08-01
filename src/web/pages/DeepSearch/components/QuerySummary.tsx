import { Stack, Typography } from "@mui/material"
import {
  useTextStream,
  type TextStreamState,
} from "../useTextStream.ts"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

type QuerySummaryProps = {
  query: string
  streamId?: string
}

function getQuerySummaryLabel(status: TextStreamState["status"]): string {
  switch (status) {
    case "idle":
    case "streaming":
      return "Summarizing search findings…"
    case "completed":
      return "Query summary"
    case "error":
      return "Query summary unavailable"
  }
}

/** Renders the retained synthesis stream for one executed search query. */
export function QuerySummary({ query, streamId }: QuerySummaryProps) {
  const stream = useTextStream(streamId)
  if (!streamId) return null

  return (
    <Stack
      component="section"
      spacing={1}
      data-query-summary-status={stream.status}
    >
      <Typography
        variant="subtitle1"
        color={stream.status === "error" ? "error" : "text.primary"}
      >
        {getQuerySummaryLabel(stream.status)}
      </Typography>
      <TextStreamOutput
        stream={stream}
        waitingText="Waiting for query summary…"
        reasoningTestId={`query-summary-reasoning-${query}`}
        textTestId={`query-summary-${query}`}
      />
    </Stack>
  )
}
