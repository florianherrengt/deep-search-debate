import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { PromptForm } from "../../components/PromptForm.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import {
  createIdeaJob,
  getIdeaJob,
  getIdeaJobs,
} from "../../lib/ideaJobs.ts"
import { IdeaJobView } from "./components/IdeaJobView.tsx"
import { useIdeaJob } from "./useIdeaJob.ts"

const ideaJobsQueryKey = ["idea-jobs"] as const

function IdeaHistory() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: ideaJobsQueryKey,
    queryFn: ({ signal }) => getIdeaJobs(signal),
  })
  const creation = useMutation({
    mutationFn: (prompt: string) => createIdeaJob({ prompt }),
    onSuccess: (ideaJobId) => {
      void queryClient.invalidateQueries({ queryKey: ideaJobsQueryKey })
      void navigate(`/ideas/${ideaJobId}`)
    },
  })

  return (
    <Stack spacing={3}>
      <Typography component="h1" variant="h4">
        Ideas
      </Typography>
      <PromptForm
        label="What should we generate ideas for?"
        onSubmit={(prompt) => creation.mutate(prompt)}
        pending={creation.isPending}
        submitLabel="Generate ideas"
      />
      {creation.error && <RequestError error={creation.error} />}

      <JobHistory
        emptyMessage="No idea runs yet."
        error={history.error}
        heading="Previous idea runs"
        headingId="idea-history"
        isPending={history.isPending}
        items={history.data?.map((job) => ({
          createdAt: job.createdAt,
          id: job.ideaJobId,
          label: job.prompt,
          status: <JobStatusBadge status={job.status} />,
          to: `/ideas/${job.ideaJobId}`,
        }))}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function IdeaDetail({ ideaJobId }: { ideaJobId: string }) {
  const job = useQuery({
    queryKey: [...ideaJobsQueryKey, ideaJobId],
    queryFn: ({ signal }) => getIdeaJob(ideaJobId, signal),
  })
  const run = useIdeaJob(ideaJobId)

  if (job.isPending) return <CircularProgress />
  if (job.error) {
    return (
      <RequestError
        error={job.error}
        notFoundMessage="This idea run does not exist or is no longer available."
        notFoundTitle="Idea run not found"
        onRetry={() => void job.refetch()}
      />
    )
  }
  return <IdeaJobView prompt={job.data.prompt} run={run} />
}

export function Ideas() {
  const { ideaJobId } = useParams<{ ideaJobId: string }>()
  return ideaJobId ? <IdeaDetail ideaJobId={ideaJobId} /> : <IdeaHistory />
}
