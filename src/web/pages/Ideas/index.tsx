import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { PromptForm } from "../../components/PromptForm.tsx"
import { RequestError } from "../../components/RequestError.tsx"
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
      void queryClient.invalidateQueries({ queryKey: ideaJobsQueryKey })
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
          status: <JobStatusBadge status={job.status} />,
          to: `/ideas/${job.slug}`,
        }))}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function IdeaJobContent({
  ideaId,
  job,
}: {
  ideaId?: string
  job: IdeaJobDetail
}) {
  const run = useIdeaJob(job.ideaJobId)
  const idea = ideaId
    ? run.ideas.find((candidate) => candidate.ideaId === ideaId)
    : undefined
  const displayIdea = idea ? run.refinedIdeas[idea.ideaId] ?? idea : undefined
  const nestedIdeaIsPending =
    ideaId !== undefined &&
    idea === undefined &&
    run.ideas.length < job.numberOfIdeas &&
    run.status !== "completed" &&
    run.status !== "failed"
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
  return <IdeaJobContent ideaId={ideaId} job={job.data} />
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
