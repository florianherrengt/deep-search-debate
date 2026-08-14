import type { DeepSearchRunState } from "../../lib/deepSearchState.ts"

export type DeepSearchRoundStatus =
  | "complete"
  | "in-progress"
  | "stopped"

export function getDeepSearchRoundNumbers(
  run: DeepSearchRunState,
): number[] {
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
    run.finalAnswerStreamId !== null ||
    run.status === "completed"
  )
}

export function getDeepSearchRoundStatus(
  run: DeepSearchRunState,
  round: number,
  roundNumbers = getDeepSearchRoundNumbers(run),
): DeepSearchRoundStatus {
  if (isRoundFinished(run, round, roundNumbers)) return "complete"
  if (run.status === "failed") return "stopped"
  return "in-progress"
}
