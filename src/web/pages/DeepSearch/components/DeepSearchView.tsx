import { Alert, CircularProgress, Stack, Typography } from "@mui/material"
import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"
import { DeepSearchHeader } from "./DeepSearchHeader.tsx"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import { ResearchRound } from "./ResearchRound.tsx"

export type DeepSearchViewProps = {
  title: string
  researchRequest: string
  run: DeepSearchRunState & { subscriptionError?: string | null }
  showHeader?: boolean
}

function getProgressMessage(run: DeepSearchRunState): string | undefined {
  if (run.status !== "running") return undefined
  if (run.queryGenerations.length === 0) return "Starting deep search…"
  if (run.roundReviews.at(-1)?.status === "running") {
    return "Reviewing whether more research is needed…"
  }
  if (run.roundReviews.at(-1)?.status === "continue") {
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

function getRoundNumbers(run: DeepSearchRunState): number[] {
  return [
    ...new Set([
      ...run.queryGenerations.map(({ round }) => round),
      ...run.roundAnswers.map(({ round }) => round),
      ...run.roundReviews.map(({ round }) => round),
      ...run.searches.map(({ round }) => round),
    ]),
  ].toSorted((first, second) => first - second)
}

function isRoundFinished(
  run: DeepSearchRunState,
  round: number,
  roundNumbers: readonly number[],
): boolean {
  const review = run.roundReviews.find((item) => item.round === round)
  return (
    (review !== undefined && review.status !== "running") ||
    roundNumbers.some((candidate) => candidate > round) ||
    run.finalAnswerStreamId !== null
  )
}

export function DeepSearchView({
  title,
  researchRequest,
  run,
  showHeader = true,
}: DeepSearchViewProps) {
  const progressMessage = getProgressMessage(run)
  const roundNumbers = getRoundNumbers(run)

  return (
    <Stack spacing={3}>
      {showHeader && <DeepSearchHeader title={title} />}
      <Typography color="text.secondary" sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}>
        {researchRequest}
      </Typography>
      {run.error && <Alert severity="error">{run.error}</Alert>}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}
      {progressMessage && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">{progressMessage}</Typography>
        </Stack>
      )}
      {roundNumbers.length > 0 && (
        <Stack component="section" spacing={2} aria-labelledby="research-rounds">
          <Stack spacing={0.5}>
            <Typography id="research-rounds" component="h2" variant="h5">
              Research rounds
            </Typography>
            <Typography color="text.secondary">
              Expand a round to inspect its queries, sources, candidate answer,
              and review.
            </Typography>
          </Stack>
          {roundNumbers.map((round) => (
            <ResearchRound
              answerStreamId={run.roundAnswers.find(
                (answer) => answer.round === round,
              )?.streamId}
              finished={isRoundFinished(run, round, roundNumbers)}
              key={round}
              queryStreamId={run.queryGenerations.find(
                (generation) => generation.round === round,
              )?.streamId}
              review={run.roundReviews.find((item) => item.round === round)}
              round={round}
              searches={run.searches.filter((search) => search.round === round)}
            />
          ))}
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
    </Stack>
  )
}
