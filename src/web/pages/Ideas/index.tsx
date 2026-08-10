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
  type IdeaJob,
} from "../../lib/ideaJobs.ts"
import { IdeaJobView } from "./components/IdeaJobView.tsx"
import { IdeaDetailView } from "./components/IdeaDetailView.tsx"
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
    onSuccess: ({ slug }) => {
      void queryClient.invalidateQueries({ queryKey: ideaJobsQueryKey })
      void navigate(`/ideas/${slug}`)
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
          label: job.title,
          prompt: job.prompt,
          status: <JobStatusBadge status={job.status} />,
          to: `/ideas/${job.slug}`,
        }))}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function IdeaJobContent({ ideaId, job }: { ideaId?: string; job: IdeaJob }) {
  const run = useIdeaJob(job.ideaJobId)
  return ideaId ? (
    <IdeaDetailView
      ideaId={ideaId}
      jobSlug={job.slug}
      jobTitle={job.title}
      numberOfIdeas={job.numberOfIdeas}
      run={run}
    />
  ) : (
    <IdeaJobView
      jobSlug={job.slug}
      prompt={job.prompt}
      run={run}
      title={job.title}
    />
  )
}

function IdeaRun({ ideaId, slug }: { ideaId?: string; slug: string }) {
  const job = useQuery({
    queryKey: [...ideaJobsQueryKey, slug],
    queryFn: ({ signal }) => getIdeaJob(slug, signal),
  })

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
  return <IdeaJobContent ideaId={ideaId} job={job.data} />
}

export function Ideas() {
  const { ideaId, slug } = useParams<{ ideaId: string; slug: string }>()
  return slug ? <IdeaRun ideaId={ideaId} slug={slug} /> : <IdeaHistory />
}
