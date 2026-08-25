import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { PromptForm } from "../../components/PromptForm.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import { ResultFeedback } from "../../components/ResultFeedback.tsx"
import { ResumeWorkflowControl } from "../../components/ResumeWorkflowControl.tsx"
import { StopWorkflowControl } from "../../components/StopWorkflowControl.tsx"
import { getRequestErrorMessage } from "../../lib/requestErrors.ts"
import { requestResearchStop } from "../../lib/researchCancellation.ts"
import { requestResearchResume } from "../../lib/researchResumption.ts"
import {
  type ResultFeedbackInput,
  updateResultFeedback,
} from "../../lib/resultFeedback.ts"
import { truncateDescription, useSeo } from "../../lib/seo.ts"
import {
  createIdeaJob,
  getIdeaJob,
  getIdeaJobs,
  type IdeaJobDetail,
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
      void queryClient.invalidateQueries({
        queryKey: ideaJobsQueryKey,
        exact: true,
      })
      void navigate(`/ideas/${slug}`)
    },
  })

  useSeo({
    title: "Generate options — RethinkLoop",
    description:
      "Generate multiple distinct, researched options from a question, goal, or set of constraints.",
    noindex: true,
  })

  return (
    <Stack spacing={3}>
      <Stack spacing={0.75}>
        <Typography component="h1" variant="h4">
          Generate options
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ maxWidth: "65ch" }}
          variant="body1"
        >
          Describe the question, goal, or constraints. You’ll get multiple
          researched options to review.
        </Typography>
      </Stack>
      <PromptForm
        label="Question, goal, or constraints"
        onSubmit={(prompt) => creation.mutate(prompt)}
        pending={creation.isPending}
        submitLabel="Generate options"
      />
      {creation.error && <RequestError error={creation.error} />}

      <JobHistory
        emptyMessage="No option runs yet."
        error={history.error}
        heading="Previous option runs"
        headingId="idea-history"
        isPending={history.isPending}
        items={history.data?.map((job) => ({
          createdAt: job.createdAt,
          id: job.ideaJobId,
          label: job.title,
          prompt: job.prompt,
          status: (
            <JobStatusBadge
              status={job.status}
              stopRequested={job.stopRequested}
            />
          ),
          to: `/ideas/${job.slug}`,
        }))}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function IdeaJobContent({
  feedbackControl,
  ideaId,
  job,
  onTerminal,
  onResume,
  onStop,
  reconnectKey,
  resumePending,
  stopError,
  stopPending,
}: {
  feedbackControl?: ReactNode
  ideaId?: string
  job: IdeaJobDetail
  onTerminal: () => void
  onResume: () => void
  onStop: () => void
  reconnectKey: number
  resumePending: boolean
  stopError: Error | null
  stopPending: boolean
}) {
  const run = useIdeaJob(job.ideaJobId, onTerminal, reconnectKey)
  const idea = ideaId
    ? run.ideas.find((candidate) => candidate.ideaId === ideaId)
    : undefined
  const displayIdea = idea ? run.refinedIdeas[idea.ideaId] ?? idea : undefined
  const nestedIdeaIsPending =
    ideaId !== undefined &&
    idea === undefined &&
    run.ideas.length < job.numberOfIdeas &&
    run.status !== "completed" &&
    run.status !== "failed" &&
    run.status !== "interrupted" &&
    run.status !== "stopping"
  const indexable = job.isIndexable
  const pageKey = `/ideas/${encodeURIComponent(job.slug)}${
    ideaId === undefined ? "" : `/${encodeURIComponent(ideaId)}`
  }`

  useSeo(
    ideaId === undefined
      ? {
          title: `${job.title} — RethinkLoop`,
          description: truncateDescription(job.prompt),
          path: job.isPublic ? pageKey : undefined,
          pageKey,
          noindex: !indexable,
          openGraphType: "article" as const,
          jsonLd: indexable
            ? {
                "@context": "https://schema.org",
                "@type": "Article",
                description: truncateDescription(job.prompt),
                headline: job.title,
                inLanguage: "en",
                isAccessibleForFree: true,
              }
            : undefined,
        }
      : displayIdea !== undefined
        ? {
            title: `${displayIdea.title} — RethinkLoop`,
            description: truncateDescription(displayIdea.description),
            path: job.isPublic ? pageKey : undefined,
            pageKey,
            noindex: !indexable,
            openGraphType: "article" as const,
            jsonLd: indexable
              ? {
                  "@context": "https://schema.org",
                  "@type": "Article",
                  description: truncateDescription(displayIdea.description),
                  headline: displayIdea.title,
                  inLanguage: "en",
                  isAccessibleForFree: true,
                }
              : undefined,
          }
        : {
            title: nestedIdeaIsPending
              ? "Loading idea — RethinkLoop"
              : "Idea not found — RethinkLoop",
            pageKey,
            noindex: true,
            enabled: !nestedIdeaIsPending,
          },
  )

  return ideaId ? (
    <IdeaDetailView
      ideaId={ideaId}
      jobSlug={job.slug}
      jobTitle={job.title}
      numberOfIdeas={job.numberOfIdeas}
      run={run}
      stopRequested={job.stopRequested}
    />
  ) : (
    <IdeaJobView
      feedbackControl={feedbackControl}
      jobSlug={job.slug}
      prompt={job.prompt}
      run={run}
      stopControl={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <ResumeWorkflowControl
            canResume={job.canResume}
            pending={resumePending}
            onResume={onResume}
          />
          <StopWorkflowControl
            canStop={job.canStop && run.status === "running"}
            pending={stopPending}
            stopping={
              job.stopRequested &&
              !job.isPublic &&
              (run.status === "running" || run.status === "stopping")
            }
            onConfirm={onStop}
          />
        </Stack>
      }
      stopError={stopError}
      stopRequested={job.stopRequested}
      title={job.title}
    />
  )
}

function IdeaRun({ ideaId, slug }: { ideaId?: string; slug: string }) {
  const queryClient = useQueryClient()
  const [reconnectKey, setReconnectKey] = useState(0)
  const job = useQuery({
    queryKey: [...ideaJobsQueryKey, slug],
    queryFn: ({ signal }) => getIdeaJob(slug, signal),
  })
  const ideaJobId = job.data?.ideaJobId
  const reconcileTerminalJob = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [...ideaJobsQueryKey, slug],
      exact: true,
    })
  }, [queryClient, slug])
  const stop = useMutation({
    mutationFn: (ideaJobId: string) =>
      requestResearchStop("idea", ideaJobId),
    onSuccess: () => {
      queryClient.setQueryData<IdeaJobDetail>(
        [...ideaJobsQueryKey, slug],
        (current) =>
          current
            ? { ...current, canStop: false, stopRequested: true }
            : current,
      )
      void queryClient.invalidateQueries({
        queryKey: ideaJobsQueryKey,
        exact: true,
      })
    },
  })
  const resume = useMutation({
    mutationFn: (ideaJobId: string) =>
      requestResearchResume("idea", ideaJobId),
    onSuccess: () => {
      queryClient.setQueryData<IdeaJobDetail>(
        [...ideaJobsQueryKey, slug],
        (current) =>
          current
            ? {
                ...current,
                canResume: false,
                canStop: true,
                status: "running",
                stopRequested: false,
                error: null,
                completedAt: null,
              }
            : current,
      )
      setReconnectKey((current) => current + 1)
      void queryClient.invalidateQueries({
        queryKey: ideaJobsQueryKey,
        exact: true,
      })
    },
  })
  const feedback = useMutation({
    mutationFn: (input: ResultFeedbackInput) => {
      if (!ideaJobId) throw new Error("Idea job is not loaded")
      return updateResultFeedback("idea", ideaJobId, input)
    },
    onSuccess: (updatedFeedback) => {
      queryClient.setQueryData<IdeaJobDetail>(
        [...ideaJobsQueryKey, slug],
        (current) =>
          current ? { ...current, feedback: updatedFeedback } : current,
      )
    },
  })
  const pageKey = `/ideas/${encodeURIComponent(slug)}${
    ideaId === undefined ? "" : `/${encodeURIComponent(ideaId)}`
  }`

  if (job.isPending) {
    return (
      <>
        <IdeaRunPendingSeo pageKey={pageKey} />
        <CircularProgress />
      </>
    )
  }
  if (job.error) {
    return (
      <>
        <IdeaRunErrorSeo pageKey={pageKey} />
        <RequestError
          error={job.error}
          notFoundMessage="This idea run does not exist or is no longer available."
          notFoundTitle="Idea run not found"
          onRetry={() => void job.refetch()}
        />
      </>
    )
  }
  return (
    <>
      {resume.error && <RequestError error={resume.error} />}
      <IdeaJobContent
        feedbackControl={
          ideaId === undefined &&
          job.data.feedback !== null &&
          job.data.creditsUsed !== null ? (
            <ResultFeedback
              creditsUsed={job.data.creditsUsed}
              error={
                feedback.error
                  ? getRequestErrorMessage(feedback.error)
                  : undefined
              }
              feedback={job.data.feedback}
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
        ideaId={ideaId}
        job={job.data}
        onResume={() => resume.mutate(job.data.ideaJobId)}
        onTerminal={reconcileTerminalJob}
        onStop={() => stop.mutate(job.data.ideaJobId)}
        reconnectKey={reconnectKey}
        resumePending={resume.isPending}
        stopError={stop.error}
        stopPending={stop.isPending}
      />
    </>
  )
}

function IdeaRunPendingSeo({ pageKey }: { pageKey: string }) {
  useSeo({
    title: "Loading idea run — RethinkLoop",
    pageKey,
    noindex: true,
    enabled: false,
  })
  return null
}

function IdeaRunErrorSeo({ pageKey }: { pageKey: string }) {
  useSeo({
    title: "Idea run not found — RethinkLoop",
    pageKey,
    noindex: true,
  })
  return null
}

export function Ideas() {
  const { ideaId, slug } = useParams<{ ideaId: string; slug: string }>()
  return slug ? <IdeaRun ideaId={ideaId} slug={slug} /> : <IdeaHistory />
}
