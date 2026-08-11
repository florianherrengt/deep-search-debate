import z from "zod"
import { config } from "../../config.ts"

const selectedUrlBudgetMessage =
  `maxSearches × maxResultsPerSearch must not exceed ` +
  `${config.deepSearch.maxSelectedUrlsPerRound} selected URLs per round`

function maximumSelectedPages(input: {
  maxSearches: number
  maxResultsPerSearch: number
  maxRounds: number
}): number {
  return (
    Math.min(
      input.maxSearches * input.maxResultsPerSearch,
      config.deepSearch.maxSelectedUrlsPerRound,
    ) * input.maxRounds
  )
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
