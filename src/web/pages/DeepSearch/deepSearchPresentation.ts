import type { DeepSearchLinkedSourceState, DeepSearchRunState } from "../../lib/deepSearchState.ts"

/** Reconstructs this round's followed-link provenance without revisiting cycles. */
export function getDeepSearchLinkedSources(
  run: DeepSearchRunState,
  round: number,
): DeepSearchLinkedSourceState[] {
  let frontier = new Set(run.searches.filter((search) => search.round === round)
    .flatMap((search) => search.results.filter((result) => result.selection === "selected")
      .map((result) => result.link)))
  const visited = new Set<string>()
  const sources: DeepSearchLinkedSourceState[] = []
  while (frontier.size > 0) {
    const next = new Set<string>()
    for (const url of frontier) {
      if (visited.has(url)) continue
      visited.add(url)
      const source = run.linkedSources.find(({ sourceUrl }) => sourceUrl === url)
      if (!source) continue
      sources.push(source)
      for (const link of source.links ?? []) next.add(link.url)
    }
    frontier = next
  }
  return sources
}

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
      ...run.roundRequirements.map(({ round }) => round),
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
  if (
    run.status === "failed" ||
    run.status === "stopping" ||
    run.status === "interrupted"
  ) {
    return "stopped"
  }
  return "in-progress"
}
