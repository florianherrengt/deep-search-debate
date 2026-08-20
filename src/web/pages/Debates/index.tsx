import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import { ResultFeedback } from "../../components/ResultFeedback.tsx"
import { StopWorkflowControl } from "../../components/StopWorkflowControl.tsx"
import {
  createDebateJob,
  getDebateJobs,
  updateDebateJob,
  type DebateTournamentSnapshot,
  type UpdateDebateJobInput,
} from "../../lib/debateJobs.ts"
import { getRequestErrorMessage } from "../../lib/requestErrors.ts"
import { requestResearchStop } from "../../lib/researchCancellation.ts"
import {
  type ResultFeedbackInput,
  updateResultFeedback,
} from "../../lib/resultFeedback.ts"
import { truncateDescription, useSeo } from "../../lib/seo.ts"
import { DebatePromptForm } from "./components/DebatePromptForm.tsx"
import { DebateMatchDetail } from "./components/DebateMatchDetail.tsx"
import { DebateVisibilityControls } from "./components/DebateVisibilityControls.tsx"
import { DebateView } from "./components/DebateView.tsx"
import { getDebateStatusPresentation } from "./debatePresentation.ts"
import { getMatch } from "./debateSelectors.ts"
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
    onSuccess: ({ slug }) => {
      void queryClient.invalidateQueries({
        queryKey: debateJobsQueryKey,
        exact: true,
      })
      void navigate(`/debates/${slug}`)
    },
  })

  useSeo({
    title: "Debates — RethinkLoop",
    description:
      "Start a debate: AI agents defend and challenge researched ideas over multiple rounds until one winner remains.",
    noindex: true,
  })

  return (
    <Stack spacing={3}>
      <DebatePromptForm
        error={
          creation.error ? getRequestErrorMessage(creation.error) : undefined
        }
        isStarting={creation.isPending}
        initialPrompt={searchParams.get("prompt") ?? ""}
        onSubmit={(input) => creation.mutate({ ...input, isPublic: false })}
      />

      <JobHistory
        emptyMessage="No debates yet."
        error={history.error}
        heading="Previous debates"
        headingId="debate-history"
        isPending={history.isPending}
        items={history.data?.map((job) => {
          const status = getDebateStatusPresentation(
            job.status,
            job.stopRequested,
          )
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

function DebateDetail({
  matchId,
  slug,
}: {
  matchId?: string
  slug: string
}) {
  const queryClient = useQueryClient()
  const job = useDebateJob(slug)
  const debatePath = `/debates/${encodeURIComponent(slug)}`
  const matchPath =
    matchId === undefined
      ? undefined
      : `${debatePath}/matches/${encodeURIComponent(matchId)}`
  const pageKey = matchPath ?? debatePath
  const match =
    matchId === undefined || job.data === undefined
      ? undefined
      : getMatch(job.data, matchId)
  const invalidMatch =
    matchId !== undefined && job.data !== undefined && match === undefined
  const debateJobId = job.data?.debateJobId
  const visibility = useMutation({
    mutationFn: (update: UpdateDebateJobInput) => {
      if (!debateJobId) throw new Error("Debate job is not loaded")
      return updateDebateJob(debateJobId, update)
    },
    onSuccess: (update) => {
      queryClient.setQueryData<DebateTournamentSnapshot>(
        debateJobQueryKey(slug),
        (current) => (current ? { ...current, ...update } : current),
      )
      void queryClient.invalidateQueries({
        queryKey: debateJobsQueryKey,
        exact: true,
      })
    },
  })
  const stop = useMutation({
    mutationFn: (id: string) => requestResearchStop("debate", id),
    onSuccess: () => {
      queryClient.setQueryData<DebateTournamentSnapshot>(
        debateJobQueryKey(slug),
        (current) =>
          current
            ? { ...current, canStop: false, stopRequested: true }
            : current,
      )
      void queryClient.invalidateQueries({
        queryKey: debateJobsQueryKey,
        exact: true,
      })
    },
  })
  const feedback = useMutation({
    mutationFn: (input: ResultFeedbackInput) => {
      if (!debateJobId) throw new Error("Debate job is not loaded")
      return updateResultFeedback("debate", debateJobId, input)
    },
    onSuccess: (updatedFeedback) => {
      queryClient.setQueryData<DebateTournamentSnapshot>(
        debateJobQueryKey(slug),
        (current) =>
          current ? { ...current, feedback: updatedFeedback } : current,
      )
    },
  })

  useSeo(
    invalidMatch
      ? {
          title: "Match not found — RethinkLoop",
          pageKey,
          noindex: true,
        }
      : job.data !== undefined
      ? {
          title: `${job.data.title} — RethinkLoop`,
          description: truncateDescription(job.data.prompt),
          path: job.data.isPublic ? debatePath : undefined,
          pageKey,
          noindex:
            !job.data.isPublic || job.data.status !== "completed",
          openGraphType: "article" as const,
          jsonLd:
            job.data.isPublic && job.data.status === "completed"
              ? {
                  "@context": "https://schema.org",
                  "@type": "Article",
                  headline: job.data.title,
                  description: truncateDescription(job.data.prompt),
                  inLanguage: "en",
                  isAccessibleForFree: true,
                }
              : undefined,
        }
      : {
          title: job.isPending
            ? "Loading debate — RethinkLoop"
            : "Debate not found — RethinkLoop",
          pageKey,
          noindex: true,
          enabled: !job.isPending,
        },
  )

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

  if (matchId) {
    if (!match) {
      return (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography component="h1" variant="h4">
            Match not found
          </Typography>
          <Typography color="text.secondary">
            This match does not exist in this debate.
          </Typography>
          <Button
            component={Link}
            to={`/debates/${encodeURIComponent(slug)}`}
            variant="contained"
          >
            Back to debate
          </Button>
        </Stack>
      )
    }

    return (
      <Stack spacing={2}>
        {job.subscriptionError && !job.data.error && (
          <Alert severity="warning">{job.subscriptionError}</Alert>
        )}
        <DebateMatchDetail match={match} tournament={job.data} />
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      {job.subscriptionError && !job.data.error && (
        <Alert severity="warning">{job.subscriptionError}</Alert>
      )}
      {stop.error && (
        <Alert severity="error">{getRequestErrorMessage(stop.error)}</Alert>
      )}
      <DebateView
        feedbackControl={
          job.data.status === "completed" && job.data.feedback !== null ? (
            <ResultFeedback
              error={
                feedback.error
                  ? getRequestErrorMessage(feedback.error)
                  : undefined
              }
              feedback={job.data.feedback}
              iconOnly
              onRatingChange={async (rating) => {
                await feedback.mutateAsync({ type: "rating", rating })
              }}
              onSubmitText={async (text) => {
                await feedback.mutateAsync({ type: "text", text })
              }}
              pending={feedback.isPending}
            />
          ) : undefined
        }
        ownerActions={
          job.data.isOwner ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <StopWorkflowControl
                canStop={job.data.canStop}
                pending={stop.isPending}
                stopping={
                  job.data.isOwner &&
                  job.data.status === "running" &&
                  job.data.stopRequested
                }
                onConfirm={() => stop.mutate(job.data.debateJobId)}
              />
              <DebateVisibilityControls
                canMakePrivate={job.data.status !== "running"}
                error={
                  visibility.error
                    ? getRequestErrorMessage(visibility.error)
                    : undefined
                }
                isPending={visibility.isPending}
                isPublic={job.data.isPublic}
                onChange={(isPublic) => visibility.mutate({ isPublic })}
                onClose={() => visibility.reset()}
                shareUrl={`${window.location.origin}/debates/${encodeURIComponent(slug)}`}
              />
            </Stack>
          ) : null
        }
        tournament={job.data}
      />
    </Stack>
  )
}

export function Debates() {
  const { matchId, slug } = useParams<{ matchId: string; slug: string }>()
  return slug ? (
    <DebateDetail matchId={matchId} slug={slug} />
  ) : (
    <DebateStart />
  )
}
