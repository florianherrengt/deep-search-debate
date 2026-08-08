import Alert from "@mui/material/Alert"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import {
  createDebateJob,
  getDebateJobs,
  updateDebateJob,
  type DebateTournamentSnapshot,
  type UpdateDebateJobInput,
} from "../../lib/debateJobs.ts"
import { getRequestErrorMessage } from "../../lib/requestErrors.ts"
import { DebatePromptForm } from "./components/DebatePromptForm.tsx"
import { DebateVisibilityControls } from "./components/DebateVisibilityControls.tsx"
import { DebateView } from "./components/DebateView.tsx"
import { debateStatusPresentation } from "./debatePresentation.ts"
import { debateJobQueryKey, useDebateJob } from "./useDebateJob.ts"

const debateJobsQueryKey = ["debate-jobs"] as const

function DebateStart() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: debateJobsQueryKey,
    queryFn: ({ signal }) => getDebateJobs(signal),
  })
  const creation = useMutation({
    mutationFn: (input: Parameters<typeof createDebateJob>[0]) =>
      createDebateJob(input),
    onSuccess: (debateJobId) => {
      void queryClient.invalidateQueries({
        queryKey: debateJobsQueryKey,
        exact: true,
      })
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
        onSubmit={(input) => creation.mutate(input)}
      />

      <JobHistory
        emptyMessage="No debates yet."
        error={history.error}
        heading="Previous debates"
        headingId="debate-history"
        isPending={history.isPending}
        items={history.data?.map((job) => {
          const status = debateStatusPresentation[job.status]
          return {
            createdAt: job.createdAt,
            id: job.debateJobId,
            label: job.prompt,
            status: (
              <Chip
                color={status.color}
                label={status.label}
                size="small"
                variant="outlined"
              />
            ),
            to: `/debates/${job.debateJobId}`,
          }
        })}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function DebateDetail({ debateJobId }: { debateJobId: string }) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const job = useDebateJob(debateJobId)
  const visibility = useMutation({
    mutationFn: (update: UpdateDebateJobInput) =>
      updateDebateJob(debateJobId, update),
    onSuccess: (update) => {
      queryClient.setQueryData<DebateTournamentSnapshot>(
        debateJobQueryKey(debateJobId),
        (current) => (current ? { ...current, ...update } : current),
      )
      void queryClient.invalidateQueries({
        queryKey: debateJobsQueryKey,
        exact: true,
      })
    },
  })

  if (job.isPending) return <CircularProgress />
  if (job.error) {
    return (
      <RequestError
        error={job.error}
        notFoundMessage="This debate does not exist or is no longer available."
        notFoundTitle="Debate not found"
        onRetry={() => void job.refetch()}
      />
    )
  }

  return (
    <Stack spacing={2}>
      {job.subscriptionError && !job.data.error && (
        <Alert severity="warning">{job.subscriptionError}</Alert>
      )}
      {job.data.isOwner ? (
        <DebateVisibilityControls
          error={
            visibility.error
              ? getRequestErrorMessage(visibility.error)
              : undefined
          }
          isPending={visibility.isPending}
          isPublic={job.data.isPublic}
          onChange={(isPublic) => visibility.mutate({ isPublic })}
          shareUrl={`${window.location.origin}/debates/${encodeURIComponent(debateJobId)}`}
        />
      ) : null}
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
