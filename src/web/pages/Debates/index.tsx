import {
  Alert,
  Chip,
  CircularProgress,
  List,
  Paper,
  Stack,
  Typography,
} from "@mui/material"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { createDebateJob, getDebateJobs } from "../../lib/debateJobs.ts"
import { DebatePromptForm } from "./components/DebatePromptForm.tsx"
import { DebateView } from "./components/DebateView.tsx"
import { debateStatusPresentation } from "./debatePresentation.ts"
import { useDebateJob } from "./useDebateJob.ts"
import { RequestError } from "../../components/RequestError.tsx"
import { getRequestErrorMessage } from "../../lib/requestErrors.ts"
import { JobHistoryListItem } from "../../components/JobHistoryListItem.tsx"

const debateJobsQueryKey = ["debate-jobs"] as const

function formatCreatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

function DebateStart() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: debateJobsQueryKey,
    queryFn: ({ signal }) => getDebateJobs(signal),
  })
  const creation = useMutation({
    mutationFn: (prompt: string) => createDebateJob(prompt),
    onSuccess: (debateJobId) => {
      void queryClient.invalidateQueries({ queryKey: debateJobsQueryKey })
      void navigate(`/debates/${debateJobId}`)
    },
  })

  return (
    <Stack spacing={3}>
      <DebatePromptForm
        error={
          creation.error ? getRequestErrorMessage(creation.error) : undefined
        }
        isStarting={creation.isPending}
        initialPrompt={searchParams.get("prompt") ?? ""}
        onSubmit={(prompt) => creation.mutate(prompt)}
      />

      <Stack component="section" spacing={1.5} aria-labelledby="debate-history">
        <Typography id="debate-history" component="h2" variant="h5">
          Previous tournaments
        </Typography>
        {history.isPending && <CircularProgress size={24} />}
        {history.error && (
          <RequestError
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        )}
        {history.data?.length === 0 && (
          <Typography color="text.secondary">No tournaments yet.</Typography>
        )}
        {history.data && history.data.length > 0 && (
          <Paper variant="outlined">
            <List disablePadding>
              {history.data.map((job) => {
                const status = debateStatusPresentation[job.status]
                return (
                  <JobHistoryListItem
                    key={job.debateJobId}
                    date={formatCreatedAt(job.createdAt)}
                    label={job.prompt}
                    status={
                      <Chip
                        color={status.color}
                        label={status.label}
                        size="small"
                        variant="outlined"
                      />
                    }
                    to={`/debates/${job.debateJobId}`}
                  />
                )
              })}
            </List>
          </Paper>
        )}
      </Stack>
    </Stack>
  )
}

function DebateDetail({ debateJobId }: { debateJobId: string }) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const job = useDebateJob(debateJobId)

  if (job.isPending) return <CircularProgress />
  if (job.error) {
    return (
      <RequestError
        error={job.error}
        notFoundMessage="This tournament does not exist or is no longer available."
        notFoundTitle="Tournament not found"
        onRetry={() => void job.refetch()}
      />
    )
  }

  return (
    <Stack spacing={2}>
      {job.subscriptionError && !job.data.error && (
        <Alert severity="warning">{job.subscriptionError}</Alert>
      )}
      <DebateView
        onSelectMatch={setSelectedMatchId}
        selectedMatchId={selectedMatchId}
        tournament={job.data}
      />
    </Stack>
  )
}

export function Debates() {
  const { debateJobId } = useParams<{ debateJobId: string }>()
  return debateJobId ? (
    <DebateDetail debateJobId={debateJobId} />
  ) : (
    <DebateStart />
  )
}
