import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Tab from "@mui/material/Tab"
import Tabs from "@mui/material/Tabs"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { JobHistory } from "../../components/JobHistory.tsx"
import { JobStatusBadge } from "../../components/JobStatusBadge.tsx"
import { PromptForm } from "../../components/PromptForm.tsx"
import { RequestError } from "../../components/RequestError.tsx"
import { truncateDescription, useSeo } from "../../lib/seo.ts"
import {
  createDeepSearchJob,
  getDeepSearchJob,
  getDeepSearchJobs,
  type DeepSearchJob,
  type DeepSearchJobOrigin,
  type DeepSearchJobSource,
} from "../../lib/deepSearchJobs.ts"
import { DeepSearchHeader } from "./components/DeepSearchHeader.tsx"
import { DeepSearchView } from "./components/DeepSearchView.tsx"
import { useDeepSearchJob } from "../../lib/useDeepSearchJob.ts"

const deepSearchJobsQueryKey = ["deep-search-jobs"] as const

export type DeepSearchServices = {
  createJob: typeof createDeepSearchJob
  getJob: typeof getDeepSearchJob
  getJobs: typeof getDeepSearchJobs
}

const defaultDeepSearchServices: DeepSearchServices = {
  createJob: createDeepSearchJob,
  getJob: getDeepSearchJob,
  getJobs: getDeepSearchJobs,
}

function deepSearchJobListQueryKey(source: DeepSearchJobSource) {
  return [...deepSearchJobsQueryKey, "list", source] as const
}

function deepSearchJobDetailQueryKey(slug: string) {
  return [...deepSearchJobsQueryKey, "detail", slug] as const
}

const automatedSource: DeepSearchJobSource = "automated"
const manualSource: DeepSearchJobSource = "manual"

function DeepSearchOrigin({ origin }: { origin: DeepSearchJobOrigin }) {
  const fromDebate = origin.kind === "debate"
  return (
    <Link to={fromDebate ? `/debates/${origin.slug}` : `/ideas/${origin.slug}`}>
      <Typography
        color="text.secondary"
        component="span"
        sx={{ overflowWrap: "anywhere", textDecoration: "underline" }}
        variant="caption"
      >
        {fromDebate ? "From debate: " : "From idea: "}
        {origin.title}
      </Typography>
    </Link>
  )
}

function DeepSearchHistory({ services }: { services: DeepSearchServices }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const source: DeepSearchJobSource =
    searchParams.get("source") === "automated" ? automatedSource : manualSource
  const history = useQuery({
    queryKey: deepSearchJobListQueryKey(source),
    queryFn: ({ signal }) => services.getJobs(source, signal),
  })
  const creation = useMutation({
    mutationFn: (request: string) =>
      services.createJob({ researchRequest: request }),
    onSuccess: ({ slug }) => {
      void queryClient.invalidateQueries({ queryKey: deepSearchJobsQueryKey })
      void navigate(`/deep-search/${slug}`)
    },
  })

  const automated = source === automatedSource
  useSeo({
    title: "Deep Search — RethinkLoop",
    description:
      "Run a deep research session: collect source results, explore the strongest candidates, and read a final answer.",
    noindex: true,
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

      <Tabs
        aria-label="Deep search sources"
        onChange={(_event, value: DeepSearchJobSource) => {
          setSearchParams(
            value === automatedSource ? { source: automatedSource } : {},
          )
        }}
        value={source}
      >
        <Tab label="My Searches" value={manualSource} />
        <Tab label="Automated" value={automatedSource} />
      </Tabs>

      <JobHistory
        emptyMessage={
          automated ? "No automated searches yet." : "No deep searches yet."
        }
        error={history.error}
        heading={automated ? "Automated searches" : "Previous searches"}
        headingId={automated ? "automated-search-history" : "search-history"}
        isPending={history.isPending}
        items={history.data?.map((job) => ({
          createdAt: job.createdAt,
          id: job.deepSearchJobId,
          label: job.title,
          origin: job.origin ? <DeepSearchOrigin origin={job.origin} /> : undefined,
          prompt: job.researchRequest,
          status: <JobStatusBadge status={job.status} />,
          to: `/deep-search/${job.slug}`,
        }))}
        onRetry={() => void history.refetch()}
      />
    </Stack>
  )
}

function DeepSearchJobContent({ job }: { job: DeepSearchJob }) {
  const run = useDeepSearchJob(job.deepSearchJobId)
  return (
    <DeepSearchView
      researchRequest={job.researchRequest}
      run={run}
      title={job.title}
    />
  )
}

function DeepSearchDetail({
  services,
  slug,
}: {
  services: DeepSearchServices
  slug: string
}) {
  const job = useQuery({
    queryKey: deepSearchJobDetailQueryKey(slug),
    queryFn: ({ signal }) => services.getJob(slug, signal),
  })
  const pageKey = `/deep-search/${encodeURIComponent(slug)}`

  useSeo(
    job.data !== undefined
      ? {
          title: `${job.data.title} — RethinkLoop`,
          description: truncateDescription(job.data.researchRequest),
          path: job.data.isPublic ? pageKey : undefined,
          pageKey,
          noindex: !job.data.isIndexable,
          openGraphType: "article" as const,
          jsonLd:
            job.data.isIndexable
              ? {
                  "@context": "https://schema.org",
                  "@type": "Article",
                  description: truncateDescription(job.data.researchRequest),
                  headline: job.data.title,
                  inLanguage: "en",
                  isAccessibleForFree: true,
                }
              : undefined,
        }
      : {
          title: job.isPending
            ? "Loading deep search — RethinkLoop"
            : "Deep search not found — RethinkLoop",
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
        notFoundMessage="This deep search does not exist or is no longer available."
        notFoundTitle="Deep search not found"
        onRetry={() => void job.refetch()}
      />
    )
  }

  return <DeepSearchJobContent job={job.data} />
}

export function DeepSearch({
  services = defaultDeepSearchServices,
}: {
  services?: DeepSearchServices
}) {
  const { slug } = useParams<{ slug: string }>()
  if (slug) {
    return <DeepSearchDetail services={services} slug={slug} />
  }
  return <DeepSearchHistory services={services} />
}
