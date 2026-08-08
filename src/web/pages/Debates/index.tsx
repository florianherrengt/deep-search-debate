import Alert from "@mui/material/Alert"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import { createDebateJob, getDebateJobs } from "../../lib/debateJobs.ts"
import { getRequestErrorMessage } from "../../lib/requestErrors.ts"
import { DebatePromptForm } from "./components/DebatePromptForm.tsx"
import { DebateView } from "./components/DebateView.tsx"
import { debateStatusPresentation } from "./debatePresentation.ts"
import { useDebateJob } from "./useDebateJob.ts"

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
    mutationFn: (prompt: string) => createDebateJob(prompt),
    onSuccess: ({ slug }) => {
      void queryClient.invalidateQueries({ queryKey: debateJobsQueryKey })
      void navigate(`/debates/${slug}`)
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
            label: job.title,
            prompt: job.prompt,
            status: (
              <Chip
                color={status.color}
                label={status.label}
                size="small"
                variant="outlined"
              />
            ),
            to: `/debates/${job.slug}`,
          }
        })}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function DebateDetail({ slug }: { slug: string }) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const job = useDebateJob(slug)

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
      <DebateView
        onSelectMatch={setSelectedMatchId}
        selectedMatchId={selectedMatchId}
        tournament={job.data}
      />
    </Stack>
  )
}

export function Debates() {
  const { slug } = useParams<{ slug: string }>()
  return slug ? (
    <DebateDetail slug={slug} />
  ) : (
    <DebateStart />
  )
}
