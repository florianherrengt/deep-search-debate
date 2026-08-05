import {
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  createIdeaJob,
  getIdeaJob,
  getIdeaJobs,
} from "../../lib/ideaJobs.ts"
import { IdeaJobView } from "./components/IdeaJobView.tsx"
import { IdeaPromptForm } from "./components/IdeaPromptForm.tsx"
import { useIdeaJob } from "./useIdeaJob.ts"
import { RequestError } from "../../components/RequestError.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"

const ideaJobsQueryKey = ["idea-jobs"] as const

function formatCreatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

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
      <IdeaPromptForm
        isGenerating={creation.isPending}
        onSubmit={(prompt) => creation.mutate(prompt)}
      />
      {creation.error && <RequestError error={creation.error} />}

      <Stack component="section" spacing={1.5} aria-labelledby="idea-history">
        <Typography id="idea-history" component="h2" variant="h5">
          Previous idea runs
        </Typography>
        {history.isPending && <CircularProgress size={24} />}
        {history.error && (
          <RequestError
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        )}
        {history.data?.length === 0 && (
          <Typography color="text.secondary">No idea runs yet.</Typography>
        )}
        {history.data && history.data.length > 0 && (
          <Paper variant="outlined">
            <List disablePadding>
              {history.data.map((job) => (
                <ListItemButton
                  key={job.ideaJobId}
                  component={Link}
                  to={`/ideas/${job.ideaJobId}`}
                  divider
                >
                  <ListItemText
                    primary={job.prompt}
                    secondary={formatCreatedAt(job.createdAt)}
                    slotProps={{
                      primary: { sx: { overflowWrap: "anywhere" } },
                    }}
                  />
                  <JobStatusBadge status={job.status} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        )}
      </Stack>
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
