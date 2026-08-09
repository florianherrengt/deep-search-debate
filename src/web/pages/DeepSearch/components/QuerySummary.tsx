import { Stack, Typography } from "@mui/material"
import {
  useTextStream,
  type TextStreamState,
} from "../../../components/streaming/useTextStream.ts"
import { TextStreamOutput } from "../../../components/streaming/TextStreamOutput.tsx"

type QuerySummaryProps = {
  query: string
  streamId?: string
}

function getQuerySummaryLabel(status: TextStreamState["status"]): string {
  switch (status) {
    case "idle":
    case "streaming":
      return "Summarizing findings…"
    case "reconnecting":
      return "Reconnecting to search summary…"
    case "completed":
      return "What this search found"
    case "error":
      return "Search summary unavailable"
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
        component="h4"
        variant="h6"
        color={stream.status === "error" ? "error" : "text.primary"}
      >
        {getQuerySummaryLabel(stream.status)}
      </Typography>
      <TextStreamOutput
        format="markdown"
        stream={stream}
        waitingText="Waiting for search findings…"
        textTestId={`query-summary-${query}`}
      />
    </Stack>
  )
}
