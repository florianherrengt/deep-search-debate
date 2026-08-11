import { config } from "../../config.ts"
import {
  allocateFairly,
  truncateMiddle,
} from "../../helpers/boundedText.ts"

type SearchSummaryContext = {
  round?: number
  query: string
  content: string
}

function getSummaryParts(summary: SearchSummaryContext) {
  const openingTag =
    summary.round === undefined
      ? "<search_summary>"
      : `<search_summary round="${summary.round + 1}">`
  const prefix = `${openingTag}\nSearch query: `
  const separator = "\nSummary:\n"
  const suffix = "\n</search_summary>"
  return {
    prefix,
    separator,
    suffix,
    fixedChars: prefix.length + separator.length + suffix.length,
  }
}

function formatSummary(
  summary: SearchSummaryContext,
  queryChars = summary.query.length,
  contentChars = summary.content.length,
): string {
  const { prefix, separator, suffix } = getSummaryParts(summary)
  return [
    prefix,
    truncateMiddle(summary.query, queryChars),
    separator,
    truncateMiddle(summary.content, contentChars),
    suffix,
  ].join("")
}

/**
 * Serializes every accumulated summary under one deterministic prompt budget.
 * Full database values remain untouched; oversized summaries receive equal
 * serialized slots so no round can crowd all other evidence out.
 */
export function formatSearchSummaryContext(
  summaries: readonly SearchSummaryContext[],
  maxChars = config.deepSearch.maxSummaryContextChars,
): string {
  if (summaries.length === 0) return ""

  const separatorChars = (summaries.length - 1) * 2
  const summaryParts = summaries.map(getSummaryParts)
  const fixedChars = summaryParts.reduce(
    (total, parts) => total + parts.fixedChars,
    separatorChars,
  )
  const desiredChars = summaries.reduce(
    (total, summary) => total + summary.query.length + summary.content.length,
    fixedChars,
  )
  if (desiredChars <= maxChars) {
    return summaries.map((summary) => formatSummary(summary)).join("\n\n")
  }

  if (fixedChars > maxChars) {
    throw new Error("Summary context budget is too small for every summary")
  }
  const variableChars = maxChars - fixedChars
  const queryChars = allocateFairly(
    summaries.map(({ query }) => query.length),
    Math.floor(variableChars * 0.25),
  )
  const contentChars = allocateFairly(
    summaries.map(({ content }) => content.length),
    variableChars - queryChars.reduce((total, chars) => total + chars, 0),
  )
  const boundedContext = summaries
    .map((summary, index) =>
      formatSummary(summary, queryChars[index], contentChars[index]),
    )
    .join("\n\n")

  if (boundedContext.length > maxChars) {
    throw new Error("Summary context exceeded its configured budget")
  }
  return boundedContext
}
