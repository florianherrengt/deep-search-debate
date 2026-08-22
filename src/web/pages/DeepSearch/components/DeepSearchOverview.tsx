import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded"
import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Divider from "@mui/material/Divider"
import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import ListItemButton from "@mui/material/ListItemButton"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Fragment, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type {
  DeepSearchRoundReviewState,
  DeepSearchRunState,
} from "../../../lib/deepSearchState.ts"
import {
  getDeepSearchRoundNumbers,
  getDeepSearchRoundStatus,
  type DeepSearchRoundStatus,
} from "../deepSearchPresentation.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { ResearchAnalysis } from "./ResearchAnalysis.tsx"
import { MarkdownText } from "../../../components/MarkdownText.tsx"

export type DeepSearchOverviewProps = {
  feedbackControl?: ReactNode
  jobSlug: string
  researchRequest: string
  run: DeepSearchRunState & { subscriptionError?: string | null }
  showHeader?: boolean
  stopControl?: ReactNode
  stopRequested?: boolean
  title: string
}

function getHeaderDescription(run: DeepSearchRunState): string {
  if (run.status === "stopping") {
    return "Stopping research after in-progress work settles."
  }
  if (run.status === "interrupted") {
    return "Research was stopped before completion. Available work has been kept."
  }
  if (run.status === "failed") {
    return run.finalAnswerStreamId
      ? "Research stopped before completion. Review the partial answer and available evidence."
      : "Research stopped before a final answer was produced."
  }
  if (run.status === "completed") {
    return run.finalAnswerStreamId
      ? "A researched answer with supporting evidence."
      : "Research completed, but no final answer was returned."
  }
  if (run.finalAnswerStreamId) {
    return "Research is complete. The final answer is being written."
  }
  if (run.status === "running") {
    return "Research is in progress. New rounds appear as evidence is collected."
  }
  return "Preparing this research job…"
}

function getProgressMessage(run: DeepSearchRunState): string | undefined {
  if (run.status !== "running") return undefined
  if (run.queryGenerations.length === 0) return "Starting deep search…"
  const latestReview = run.roundReviews.at(-1)
  if (latestReview?.status === "running") return undefined
  if (latestReview?.status === "continue") {
    return "Preparing the next research round…"
  }
  if (
    run.roundAnswers.length > 0 &&
    run.roundAnswers.at(-1)?.round === run.queryGenerations.at(-1)?.round
  ) {
    return "Writing and evaluating the current answer…"
  }
  if (run.searches.length === 0) return "Searching the web…"
  if (!run.finalAnswerStreamId) return "Researching and summarizing…"
  return undefined
}

function getRoundDescription(
  answerStreamId: string | undefined,
  review: DeepSearchRoundReviewState | undefined,
  status: DeepSearchRoundStatus,
): string {
  if (status === "stopped") {
    return "Research stopped before this round could finish."
  }
  if (review?.reason) return review.reason
  if (review?.status === "running") {
    return "Reviewing whether more research is needed…"
  }
  if (status === "complete") return "The candidate answer is ready."
  if (answerStreamId) return "Writing the candidate answer…"
  return "Gathering sources and analysing evidence…"
}

function formatSearchCount(count: number): string {
  return `${count} ${count === 1 ? "search" : "searches"}`
}

export function DeepSearchOverview({
  feedbackControl,
  jobSlug,
  researchRequest,
  run,
  showHeader = true,
  stopControl,
  stopRequested = false,
  title,
}: DeepSearchOverviewProps) {
  const presentationRun: DeepSearchRunState =
    stopRequested && run.status === "running"
      ? { ...run, status: "stopping" }
      : run
  const progressMessage = getProgressMessage(presentationRun)
  const roundNumbers = getDeepSearchRoundNumbers(presentationRun)

  return (
    <Stack spacing={3}>
      {showHeader && (
        <DeepSearchHeader
          description={
            presentationRun.status === "interrupted" && !stopRequested
              ? "Research was interrupted before completion. Available work has been kept."
              : getHeaderDescription(presentationRun)
          }
          title={title}
        />
      )}
      {stopControl}
      <MarkdownText
        sx={{ maxWidth: "85ch" }}
        text={researchRequest}
      />
      {run.error && (
        <Alert severity={presentationRun.status === "interrupted" ? "info" : "error"}>
          {presentationRun.status === "interrupted" && (
            <AlertTitle>{stopRequested ? "Stopped" : "Interrupted"}</AlertTitle>
          )}
          {run.error}
        </Alert>
      )}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}
      {progressMessage && (
        <Stack
          direction="row"
          role="status"
          spacing={1.25}
          sx={{ alignItems: "center", py: 0.5 }}
        >
          <CircularProgress aria-hidden="true" size={20} />
          <Typography color="text.secondary">{progressMessage}</Typography>
        </Stack>
      )}
      {run.finalAnswerStreamId && (
        <GenerationOutput
          announcementLabel="Final answer"
          format="markdown"
          headingComponent="h2"
          streamId={run.finalAnswerStreamId}
          title="Final answer"
          waitingText="Writing the final answer…"
          testId="final-answer"
        />
      )}
      {presentationRun.status === "completed" && feedbackControl}
      {run.researchAnalysis && (
        <ResearchAnalysis analysis={run.researchAnalysis} />
      )}
      {roundNumbers.length > 0 && (
        <Stack
          aria-labelledby="research-rounds-heading"
          component="section"
          spacing={1.5}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={0.5}
            sx={{ alignItems: { sm: "baseline" }, justifyContent: "space-between" }}
          >
            <Typography
              component="h2"
              id="research-rounds-heading"
              variant="h5"
            >
              Research rounds
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Open a round to inspect its queries, sources, and evidence review.
            </Typography>
          </Stack>
          <Paper variant="outlined" sx={{ overflow: "hidden" }}>
            <List aria-labelledby="research-rounds-heading" disablePadding>
              {roundNumbers.map((round, index) => {
                const status = getDeepSearchRoundStatus(
                  presentationRun,
                  round,
                  roundNumbers,
                )
                const review = run.roundReviews.find(
                  (item) => item.round === round,
                )
                const answerStreamId = run.roundAnswers.find(
                  (answer) => answer.round === round,
                )?.streamId
                const searchCount = run.searches.filter(
                  (search) => search.round === round,
                ).length
                const statusLabel =
                  status === "complete"
                    ? "Complete"
                    : status === "stopped"
                      ? "Stopped"
                      : "In progress"

                return (
                  <Fragment key={round}>
                    {index > 0 && <Divider component="li" />}
                    <ListItem disablePadding>
                      <ListItemButton
                        component={Link}
                        sx={{ gap: 2, minWidth: 0, px: { xs: 2, sm: 2.5 }, py: 2 }}
                        to={`/deep-search/${encodeURIComponent(jobSlug)}/rounds/${round + 1}`}
                      >
                        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ alignItems: "center", flexWrap: "wrap" }}
                          >
                            <Typography component="span" variant="h6">
                              Round {round + 1}
                            </Typography>
                            <Chip
                              color={
                                status === "in-progress"
                                  ? "primary"
                                  : status === "stopped"
                                    ? "error"
                                    : "default"
                              }
                              label={statusLabel}
                              size="small"
                              variant="outlined"
                            />
                            <Typography color="text.secondary" variant="caption">
                              {formatSearchCount(searchCount)}
                            </Typography>
                          </Stack>
                          <Typography
                            color="text.secondary"
                            component="span"
                            sx={{ overflowWrap: "anywhere" }}
                            variant="body2"
                          >
                            {getRoundDescription(answerStreamId, review, status)}
                          </Typography>
                        </Stack>
                        <ChevronRightRounded aria-hidden="true" color="action" />
                      </ListItemButton>
                    </ListItem>
                  </Fragment>
                )
              })}
            </List>
          </Paper>
        </Stack>
      )}
    </Stack>
  )
}
