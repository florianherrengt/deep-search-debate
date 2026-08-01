import { Alert, CircularProgress, Stack, Typography } from "@mui/material"
import type { DeepSearchRunState } from "../deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { GenerationOutput } from "./GenerationOutput.tsx"
import { SearchResults } from "./SearchResults.tsx"

export type DeepSearchViewProps = {
  researchRequest: string
  run: DeepSearchRunState
}

function getProgressMessage(run: DeepSearchRunState): string | undefined {
  if (run.status !== "running") return undefined
  if (!run.queryStreamId) return "Starting deep search…"
  if (run.searches.length === 0) return "Searching the web…"
  return undefined
}

export function DeepSearchView({
  researchRequest,
  run,
}: DeepSearchViewProps) {
  const progressMessage = getProgressMessage(run)

  return (
    <Stack spacing={3}>
      <DeepSearchHeader />
      <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
        {researchRequest}
      </Typography>
      {run.error && <Alert severity="error">{run.error}</Alert>}
      {progressMessage && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">{progressMessage}</Typography>
        </Stack>
      )}
      {run.queryStreamId && (
        <GenerationOutput
          streamId={run.queryStreamId}
          title="Generated search queries"
          waitingText="Generating search queries…"
          testId="generated-search-queries"
        />
      )}
      <SearchResults searches={run.searches} />
    </Stack>
  )
}
