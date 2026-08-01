import { Stack } from "@mui/material"
import type { SubmitEventHandler } from "react"
import type { DeepSearchRunState } from "../deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { DeepSearchJobStatus } from "./DeepSearchJobStatus.tsx"
import { GeneratedQueries } from "./GeneratedQueries.tsx"
import { ProgressMessage } from "./ProgressMessage.tsx"
import { ResearchRequestForm } from "./ResearchRequestForm.tsx"
import { SearchResults } from "./SearchResults.tsx"

export type DeepSearchViewProps = {
  researchRequest: string
  run: DeepSearchRunState
  onResearchRequestChange: (value: string) => void
  onSubmit: SubmitEventHandler<HTMLFormElement>
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
  onResearchRequestChange,
  onSubmit,
}: DeepSearchViewProps) {
  const isSearching = run.status === "running"
  const progressMessage = getProgressMessage(run)

  return (
    <Stack spacing={3}>
      <DeepSearchHeader />
      <ResearchRequestForm
        researchRequest={researchRequest}
        isSearching={isSearching}
        onResearchRequestChange={onResearchRequestChange}
        onSubmit={onSubmit}
      />
      <DeepSearchJobStatus
        jobId={run.jobId}
        error={run.error}
      />
      <GeneratedQueries streamId={run.queryStreamId} />
      {progressMessage && <ProgressMessage>{progressMessage}</ProgressMessage>}
      <SearchResults searches={run.searches} />
    </Stack>
  )
}
