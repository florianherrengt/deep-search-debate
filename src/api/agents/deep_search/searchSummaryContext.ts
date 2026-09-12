import { config } from "../../config.ts"
import {
  allocateFairly,
  truncateMiddle,
  selectRelevantPassages,
} from "../../helpers/boundedText.ts"
import { MAX_WEB_SEARCH_TITLE_CHARS } from "../../web_search/types.ts"

type SearchSummaryContext = {
  round?: number
  query: string
  content: string
}

export type SourceEvidence = {
  url: string
  title: string
  content: string
  originalPassages?: string
  evidenceType: "page-summary" | "search-snippet" | "unavailable"
}

function getSourceParts({ url, title, evidenceType, originalPassages }: SourceEvidence) {
  const metadata = JSON.stringify({
    url,
    title: truncateMiddle(title, MAX_WEB_SEARCH_TITLE_CHARS),
    evidenceType,
  })
  const prefix = `<source_evidence>\n${metadata}\nContent:\n`
  const suffix = "\n</source_evidence>"
  const passageSeparator = originalPassages ? "\nOriginal source passages (verbatim excerpts; omissions marked):\n" : ""
  return { prefix, suffix, passageSeparator, fixedChars: prefix.length + suffix.length + passageSeparator.length }
}

function formatSource(
  source: SourceEvidence,
  contentChars = source.content.length + (source.originalPassages?.length ?? 0),
  query = "",
) {
  const { prefix, suffix, passageSeparator } = getSourceParts(source)
  const summaryChars = source.originalPassages
    ? Math.min(source.content.length, Math.max(Math.floor(contentChars / 4), contentChars - source.originalPassages.length)) : contentChars
  return prefix + truncateMiddle(source.content, summaryChars) + passageSeparator
    + (source.originalPassages ? selectRelevantPassages(source.originalPassages, `${query}\n${source.content}`, contentChars - summaryChars) : "") + suffix
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
 * content slots alongside direct sources. Source URLs and evidence types are
 * fixed metadata and cannot be removed by content truncation.
 */
export function formatSearchSummaryContext(
  summaries: readonly SearchSummaryContext[],
  maxChars = config.deepSearch.maxSummaryContextChars,
  sourceEvidence: readonly SourceEvidence[] = [],
  researchRequest = "",
): string {
  if (summaries.length + sourceEvidence.length === 0) return ""

  const separatorChars = (summaries.length + sourceEvidence.length - 1) * 2
  const summaryParts = summaries.map(getSummaryParts)
  const fixedChars = [
    ...summaryParts,
    ...sourceEvidence.map(getSourceParts),
  ].reduce(
    (total, parts) => total + parts.fixedChars,
    separatorChars,
  )
  const desiredChars = summaries.reduce(
    (total, summary) => total + summary.query.length + summary.content.length,
    sourceEvidence.reduce(
      (total, source) => total + source.content.length + (source.originalPassages?.length ?? 0),
      fixedChars,
    ),
  )
  if (desiredChars <= maxChars) {
    return [
      ...summaries.map((summary) => formatSummary(summary)),
      ...sourceEvidence.map((source) => formatSource(source, undefined, researchRequest)),
    ].join("\n\n")
  }

  if (fixedChars > maxChars) {
    throw new Error(
      "Summary context budget is too small for every summary and source metadata",
    )
  }
  const variableChars = maxChars - fixedChars
  const queryChars = allocateFairly(
    summaries.map(({ query }) => query.length),
    Math.floor(variableChars * 0.25),
  )
  const contentChars = allocateFairly(
    [...summaries.map(({ content }) => content.length), ...sourceEvidence.map(({ content, originalPassages }) => content.length + (originalPassages?.length ?? 0))],
    variableChars - queryChars.reduce((total, chars) => total + chars, 0),
  )
  const boundedContext = [
    ...summaries.map((summary, index) =>
      formatSummary(summary, queryChars[index], contentChars[index]),
    ),
    ...sourceEvidence.map((source, index) =>
      formatSource(source, contentChars[summaries.length + index], researchRequest),
    ),
  ].join("\n\n")

  if (boundedContext.length > maxChars) {
    throw new Error("Summary context exceeded its configured budget")
  }
  return boundedContext
}
