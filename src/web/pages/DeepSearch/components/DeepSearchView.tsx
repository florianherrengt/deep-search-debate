import { Alert, CircularProgress, Stack, Typography } from "@mui/material"
import type { DeepSearchRunState } from "../deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import { SearchResults } from "./SearchResults.tsx"

export type DeepSearchViewProps = {
  researchRequest: string
  run: DeepSearchRunState & { subscriptionError?: string | null }
  showHeader?: boolean
}

function getProgressMessage(run: DeepSearchRunState): string | undefined {
  if (run.status !== "running") return undefined
  if (!run.queryStreamId) return "Starting deep search…"
  if (run.searches.length === 0) return "Searching the web…"
  if (!run.finalAnswerStreamId) return "Researching and summarizing…"
  return undefined
}

export function DeepSearchView({
  researchRequest,
  run,
  showHeader = true,
}: DeepSearchViewProps) {
  const progressMessage = getProgressMessage(run)

  return (
    <Stack spacing={3}>
      {showHeader && <DeepSearchHeader />}
      <Typography component="p" variant="h6" sx={{ overflowWrap: "anywhere" }}>
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
      {run.queryStreamId && (
        <GenerationOutput
          headingComponent="h2"
          streamId={run.queryStreamId}
          title="Generated search queries"
          waitingText="Generating search queries…"
          testId="generated-search-queries"
        />
      )}
      {run.finalAnswerStreamId && (
        <GenerationOutput
          announcementLabel="Final answer"
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
