import { Stack } from "@mui/material"
import type { SubmitEventHandler } from "react"
import type { DeepSearchRunState } from "../deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { DeepSearchJobStatus } from "./DeepSearchJobStatus.tsx"
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
  const showResearchForm = run.status === "idle" || run.status === "failed"

  return (
    <Stack spacing={3}>
      <DeepSearchHeader />
      {showResearchForm && (
        <ResearchRequestForm
          researchRequest={researchRequest}
          isSearching={isSearching}
          onResearchRequestChange={onResearchRequestChange}
          onSubmit={onSubmit}
        />
      )}
      <DeepSearchJobStatus error={run.error} />
      {progressMessage && <ProgressMessage>{progressMessage}</ProgressMessage>}
      <SearchResults searches={run.searches} />
    </Stack>
  )
}
