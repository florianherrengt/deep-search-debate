import { CircularProgress, Stack, Typography } from "@mui/material"
import {
  useTextStream,
  type TextStreamState,
} from "../../../components/streaming/useTextStream.ts"
import type { DeepSearchPageSummary } from "../deepSearchState.ts"
import { TextStreamOutput } from "../../../components/streaming/TextStreamOutput.tsx"

type PageSummaryProps = {
  summary: DeepSearchPageSummary
}

type PageSummaryStatus = "extracting" | TextStreamState["status"]

function getPageSummaryLabel(status: PageSummaryStatus): string {
  switch (status) {
    case "extracting":
      return "Extracting page content…"
    case "idle":
    case "streaming":
      return "Summarizing source…"
    case "reconnecting":
      return "Reconnecting to source findings…"
    case "completed":
      return "Source findings"
    case "error":
      return "Source findings unavailable"
  }
}

function getPageSummaryStreamId(
  summary: DeepSearchPageSummary,
): string | null {
  if (summary.status === "stream") return summary.streamId
  return null
}

function getPageSummaryStatus(
  summary: DeepSearchPageSummary,
  stream: TextStreamState,
): PageSummaryStatus {
  if (summary.status === "stream") return stream.status
  return summary.status
}

function getPageSummaryColor(
  status: PageSummaryStatus,
): "error" | "text.secondary" {
  if (status === "error") return "error"
  return "text.secondary"
}

export function PageSummary({ summary }: PageSummaryProps) {
  const hasStream = summary.status === "stream"
  const stream = useTextStream(getPageSummaryStreamId(summary))
  const status = getPageSummaryStatus(summary, stream)
  const isWorking =
    status === "extracting" ||
    status === "streaming" ||
    status === "reconnecting"
  const label = getPageSummaryLabel(status)

  return (
    <Stack
      component="section"
      spacing={1}
      data-summary-status={status}
      sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        {isWorking && <CircularProgress size={14} />}
        <Typography
          variant="subtitle2"
          color={getPageSummaryColor(status)}
        >
          {label}
        </Typography>
      </Stack>

      {hasStream && (
        <TextStreamOutput
          format="markdown"
          stream={stream}
          waitingText="Waiting for source findings…"
          textTestId="page-summary-text"
        />
      )}

      {summary.status === "error" && (
        <Typography variant="body2" color="error">
          {summary.message}
        </Typography>
      )}
    </Stack>
  )
}
