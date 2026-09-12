import z from "zod"
import { config } from "../../config.ts"

const selectedUrlBudgetMessage =
  `maxSearches × maxResultsPerSearch must not exceed ` +
  `${config.deepSearch.maxSelectedUrlsPerRound} selected URLs per round`

type PageBudgetInput = {
  maxSearches: number
  maxResultsPerSearch: number
}

function getSearchPageBudget(input: PageBudgetInput): number {
  return Math.min(
    input.maxSearches * input.maxResultsPerSearch,
    config.deepSearch.maxSelectedUrlsPerRound,
  )
}

/** The total allowance for distinct linked destinations across one round. */
export function getLinkedPageBudget(input: PageBudgetInput): number {
  return config.deepSearch.maxLinkDepth > 0 ? 3 * getSearchPageBudget(input) : 0
}

/** Cumulative allowance at a zero-based hop, reserving one search-page allowance for each later hop. */
export function getLinkedPageDepthBudget(input: PageBudgetInput, depth: number): number {
  const reserved = Math.max(0, config.deepSearch.maxLinkDepth - depth - 1) * getSearchPageBudget(input)
  return Math.max(0, getLinkedPageBudget(input) - reserved)
}

function maximumSelectedPages(input: PageBudgetInput & {
  maxRounds: number
}): number {
  return (getSearchPageBudget(input) + getLinkedPageBudget(input)) * input.maxRounds
}

export function maximumSelectedPagesForChildren(
  input: {
    maxSearches: number
    maxResultsPerSearch: number
    maxRounds: number
  },
  childSearchCount: number,
): number {
  return maximumSelectedPages(input) * childSearchCount
}

export const rootSelectedPageBudgetMessage =
  `The complete workflow cannot select more than ` +
  `${config.deepSearch.maxSelectedPagesPerRootJob} selected pages`

export const deepSearchResearchRequestSchema = z
  .string()
  .trim()
  .min(1)
  .max(config.deepSearch.maxRequestChars)

export const deepSearchControlsSchema = z
  .object({
    maxSearches: z
      .number()
      .int()
      .positive()
      .max(config.deepSearch.maxSearches)
      .default(3),
    maxResultsPerSearch: z
      .number()
      .int()
      .positive()
      .max(config.deepSearch.maxResultsPerSearch)
      .default(3),
    maxRounds: z
      .number()
      .int()
      .positive()
      .max(config.deepSearch.maxRounds)
      .default(Math.min(3, config.deepSearch.maxRounds)),
  })
  .refine(
    ({ maxSearches, maxResultsPerSearch }) =>
      maxSearches * maxResultsPerSearch <=
      config.deepSearch.maxSelectedUrlsPerRound,
    {
      message: selectedUrlBudgetMessage,
      path: ["maxResultsPerSearch"],
    },
  )
  .refine(
    (input) =>
      maximumSelectedPages(input) <=
      config.deepSearch.maxSelectedPagesPerRootJob,
    {
      message: rootSelectedPageBudgetMessage,
      path: ["maxRounds"],
    },
  )

export const deepSearchExecutionInputSchema =
  deepSearchControlsSchema.safeExtend({
    researchRequest: deepSearchResearchRequestSchema,
  })

export type DeepSearchExecutionRequest = z.input<
  typeof deepSearchExecutionInputSchema
>
