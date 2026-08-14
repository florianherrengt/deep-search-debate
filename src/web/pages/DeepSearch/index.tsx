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
  type DeepSearchJobDetail,
  type DeepSearchJobOrigin,
  type DeepSearchJobSource,
} from "../../lib/deepSearchJobs.ts"
import { DeepSearchHeader } from "./components/DeepSearchHeader.tsx"
import { DeepSearchOverview } from "./components/DeepSearchOverview.tsx"
import { DeepSearchRoundDetail } from "./components/DeepSearchRoundDetail.tsx"
import { getDeepSearchRoundNumbers } from "./deepSearchPresentation.ts"
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

function parseRoundNumber(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null
  const roundNumber = Number(value)
  return Number.isSafeInteger(roundNumber) ? roundNumber : null
}

function DeepSearchJobContent({
  job,
  routeRoundNumber,
}: {
  job: DeepSearchJobDetail
  routeRoundNumber?: string
}) {
  const run = useDeepSearchJob(job.deepSearchJobId)
  const parentPageKey = `/deep-search/${encodeURIComponent(job.slug)}`
  const roundNumber = parseRoundNumber(routeRoundNumber)
  const roundIndex = roundNumber === null ? null : roundNumber - 1
  const roundExists =
    roundIndex !== null && getDeepSearchRoundNumbers(run).includes(roundIndex)
  const roundRouteResolved =
    routeRoundNumber === undefined ||
    roundNumber === null ||
    roundNumber > job.maxRounds ||
    roundExists ||
    run.status === "completed" ||
    run.status === "failed"
  const roundPageKey =
    routeRoundNumber === undefined
      ? undefined
      : `${parentPageKey}/rounds/${encodeURIComponent(routeRoundNumber)}`
  const roundNotFound =
    routeRoundNumber !== undefined &&
    roundRouteResolved &&
    (roundNumber === null || roundNumber > job.maxRounds || !roundExists)
  const description = truncateDescription(job.researchRequest)

  useSeo(
    roundNotFound
      ? {
          title: "Research round not found — RethinkLoop",
          pageKey: roundPageKey,
          noindex: true,
        }
      : {
          title: `${job.title} — RethinkLoop`,
          description,
          path: job.isPublic ? parentPageKey : undefined,
          pageKey: roundPageKey ?? parentPageKey,
          noindex: !job.isIndexable,
          openGraphType: "article" as const,
          jsonLd:
            job.isIndexable
              ? {
                  "@context": "https://schema.org",
                  "@type": "Article",
                  description,
                  headline: job.title,
                  inLanguage: "en",
                  isAccessibleForFree: true,
                }
              : undefined,
          enabled: roundRouteResolved,
        },
  )

  if (routeRoundNumber !== undefined) {
    return (
      <DeepSearchRoundDetail
        jobSlug={job.slug}
        jobTitle={job.title}
        maxRounds={job.maxRounds}
        researchRequest={job.researchRequest}
        roundNumber={roundNumber ?? Number.NaN}
        run={run}
      />
    )
  }

  return (
    <DeepSearchOverview
      jobSlug={job.slug}
      researchRequest={job.researchRequest}
      run={run}
      title={job.title}
    />
  )
}

function DeepSearchDetail({
  routeRoundNumber,
  services,
  slug,
}: {
  routeRoundNumber?: string
  services: DeepSearchServices
  slug: string
}) {
  const job = useQuery({
    queryKey: deepSearchJobDetailQueryKey(slug),
    queryFn: ({ signal }) => services.getJob(slug, signal),
  })
  const parentPageKey = `/deep-search/${encodeURIComponent(slug)}`
  const pageKey =
    routeRoundNumber === undefined
      ? parentPageKey
      : `${parentPageKey}/rounds/${encodeURIComponent(routeRoundNumber)}`

  useSeo(
    job.data === undefined
      ? {
          title: job.isPending
            ? "Loading deep search — RethinkLoop"
            : "Deep search not found — RethinkLoop",
          pageKey,
          noindex: true,
          enabled: !job.isPending,
        }
      : {
          title:
            routeRoundNumber === undefined
              ? "Loading deep search — RethinkLoop"
              : "Loading research round — RethinkLoop",
          pageKey,
          noindex: true,
          enabled: false,
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

  return (
    <DeepSearchJobContent
      job={job.data}
      routeRoundNumber={routeRoundNumber}
    />
  )
}

export function DeepSearch({
  services = defaultDeepSearchServices,
}: {
  services?: DeepSearchServices
}) {
  const { roundNumber, slug } = useParams<{
    roundNumber?: string
    slug: string
  }>()
  if (slug) {
    return (
      <DeepSearchDetail
        routeRoundNumber={roundNumber}
        services={services}
        slug={slug}
      />
    )
  }
  return <DeepSearchHistory services={services} />
}
