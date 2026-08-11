import { Alert, CircularProgress, Stack, Typography } from "@mui/material"
import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import { SearchResults } from "./SearchResults.tsx"

export type DeepSearchViewProps = {
  title: string
  researchRequest: string
  run: DeepSearchRunState & { subscriptionError?: string | null }
  showHeader?: boolean
}

function getProgressMessage(run: DeepSearchRunState): string | undefined {
  if (run.status !== "running") return undefined
  if (run.queryGenerations.length === 0) return "Starting deep search…"
  if (run.roundReviews.at(-1)?.status === "running") {
    return "Reviewing whether more research is needed…"
  }
  if (run.searches.length === 0) return "Searching the web…"
  if (!run.finalAnswerStreamId) return "Researching and summarizing…"
  return undefined
}

export function DeepSearchView({
  title,
  researchRequest,
  run,
  showHeader = true,
}: DeepSearchViewProps) {
  const progressMessage = getProgressMessage(run)

  return (
    <Stack spacing={3}>
      {showHeader && <DeepSearchHeader title={title} />}
      <Typography color="text.secondary" sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}>
        {researchRequest}
      </Typography>
      {run.error && <Alert severity="error">{run.error}</Alert>}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}
      {progressMessage && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">{progressMessage}</Typography>
        </Stack>
      )}
      {run.queryGenerations.map((generation) => (
        <GenerationOutput
          format="structured-list"
          headingComponent="h2"
          key={generation.round}
          streamId={generation.streamId}
          title={`Round ${generation.round + 1} search queries`}
          waitingText="Generating search queries…"
          testId={`generated-search-queries-${generation.round}`}
        />
      ))}
      {run.roundReviews.map((review) => (
        <Stack key={review.round} spacing={1}>
          {review.streamId && (
            <GenerationOutput
              headingComponent="h2"
              showText={false}
              streamId={review.streamId}
              title={`Round ${review.round + 1} research review`}
              waitingText="Reviewing the available evidence…"
              testId={`round-review-${review.round}`}
            />
          )}
          {review.status !== "running" && (
            <Alert severity={review.status === "error" ? "warning" : "info"}>
              {review.status === "continue"
                ? "More research requested. "
                : review.status === "stop"
                  ? "Research is sufficient. "
                  : "Review failed; continuing with the current evidence. "}
              {review.reason}
            </Alert>
          )}
        </Stack>
      ))}
      {run.finalAnswerStreamId && (
        <GenerationOutput
          announcementLabel="Final answer"
          format="markdown"
          headingComponent="h2"
          streamId={run.finalAnswerStreamId}
          title="Final answer"
          waitingText="Writing the final answer…"
          testId="final-answer"
        />
      )}
      <SearchResults searches={run.searches} />
    </Stack>
  )
}
