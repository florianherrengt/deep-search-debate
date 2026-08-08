import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { PromptForm } from "../../components/PromptForm.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import {
  createDeepSearchJob,
  getDeepSearchJob,
  getDeepSearchJobs,
} from "../../lib/deepSearchJobs.ts"
import { DeepSearchHeader } from "./components/DeepSearchHeader.tsx"
import { DeepSearchView } from "./components/DeepSearchView.tsx"
import { useDeepSearchJob } from "./useDeepSearchJob.ts"

const deepSearchJobsQueryKey = ["deep-search-jobs"] as const

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
      <PromptForm
        label="Research request"
        onSubmit={(request) => creation.mutate(request)}
        pending={creation.isPending}
        submitLabel="Start deep search"
      />
      {creation.error && <RequestError error={creation.error} />}

      <JobHistory
        emptyMessage="No deep searches yet."
        error={history.error}
        heading="Previous searches"
        headingId="search-history"
        isPending={history.isPending}
        items={history.data?.map((job) => ({
          createdAt: job.createdAt,
          id: job.deepSearchJobId,
          label: job.researchRequest,
          status: <JobStatusBadge status={job.status} />,
          to: `/deep-search/${job.deepSearchJobId}`,
        }))}
        onRetry={() => void history.refetch()}
      />
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
    <DeepSearchView researchRequest={job.data.researchRequest} run={run} />
  )
}

export function DeepSearch() {
  const { deepSearchJobId } = useParams<{ deepSearchJobId: string }>()
  if (deepSearchJobId) {
    return <DeepSearchDetail deepSearchJobId={deepSearchJobId} />
  }
  return <DeepSearchHistory />
}
