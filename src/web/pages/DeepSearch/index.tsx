import {
  CircularProgress,
  List,
  Paper,
  Stack,
  Typography,
} from "@mui/material"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import {
  createDeepSearchJob,
  getDeepSearchJob,
  getDeepSearchJobs,
} from "../../lib/deepSearchJobs.ts"
import { DeepSearchHeader } from "./components/DeepSearchHeader.tsx"
import { DeepSearchView } from "./components/DeepSearchView.tsx"
import { ResearchRequestForm } from "./components/ResearchRequestForm.tsx"
import { useDeepSearchJob } from "./useDeepSearchJob.ts"
import { RequestError } from "../../components/RequestError.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { JobHistoryListItem } from "../../components/JobHistoryListItem.tsx"

const deepSearchJobsQueryKey = ["deep-search-jobs"] as const

function formatCreatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

function DeepSearchHistory() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: deepSearchJobsQueryKey,
    queryFn: ({ signal }) => getDeepSearchJobs(signal),
  })
  const creation = useMutation({
    mutationFn: (request: string) =>
      createDeepSearchJob({ researchRequest: request }),
    onSuccess: (deepSearchJobId) => {
      void queryClient.invalidateQueries({ queryKey: deepSearchJobsQueryKey })
      void navigate(`/deep-search/${deepSearchJobId}`)
    },
  })

  return (
    <Stack spacing={3}>
      <DeepSearchHeader />
      <ResearchRequestForm
        isSearching={creation.isPending}
        onSubmit={(request) => creation.mutate(request)}
      />
      {creation.error && (
        <RequestError error={creation.error} />
      )}

      <Stack component="section" spacing={1.5} aria-labelledby="search-history">
        <Typography id="search-history" component="h2" variant="h5">
          Previous searches
        </Typography>
        {history.isPending && <CircularProgress size={24} />}
        {history.error && (
          <RequestError
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        )}
        {history.data?.length === 0 && (
          <Typography color="text.secondary">No deep searches yet.</Typography>
        )}
        {history.data && history.data.length > 0 && (
          <Paper variant="outlined">
            <List disablePadding>
              {history.data.map((job) => (
                <JobHistoryListItem
                  key={job.deepSearchJobId}
                  date={formatCreatedAt(job.createdAt)}
                  label={job.researchRequest}
                  status={<JobStatusBadge status={job.status} />}
                  to={`/deep-search/${job.deepSearchJobId}`}
                />
              ))}
            </List>
          </Paper>
        )}
      </Stack>
    </Stack>
  )
}

function DeepSearchDetail({ deepSearchJobId }: { deepSearchJobId: string }) {
  const job = useQuery({
    queryKey: [...deepSearchJobsQueryKey, deepSearchJobId],
    queryFn: ({ signal }) => getDeepSearchJob(deepSearchJobId, signal),
  })
  const run = useDeepSearchJob(deepSearchJobId)

  if (job.isPending) return <CircularProgress />
  if (job.error) {
    return (
      <RequestError
        error={job.error}
        notFoundMessage="This deep search does not exist or is no longer available."
        notFoundTitle="Deep search not found"
        onRetry={() => void job.refetch()}
      />
    )
  }

  return (
    <DeepSearchView
      researchRequest={job.data.researchRequest}
      run={run}
    />
  )
}

export function DeepSearch() {
  const { deepSearchJobId } = useParams<{ deepSearchJobId: string }>()
  if (deepSearchJobId) {
    return <DeepSearchDetail deepSearchJobId={deepSearchJobId} />
  }
  return <DeepSearchHistory />
}
