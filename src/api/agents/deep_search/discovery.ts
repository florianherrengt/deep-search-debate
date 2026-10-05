import z from "zod"
import { config } from "../../config.ts"
import { formatBoundedTextEntries } from "../../helpers/boundedText.ts"
import { secureJsonParse } from "../../helpers/secureJsonParse.ts"
import { generateObjectStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import { canonicalUrl } from "../../web_search/types.ts"
import {
  awaitGenerationOutput,
  awaitGenerationText,
  type TextGenerationPersistenceCallbacks,
} from "../../llms/streams.ts"
import { formatSearchSummaryContext, getSourceParts, type SourceEvidence } from "./searchSummaryContext.ts"

export const discoveryInventorySchema = z.object({
  options: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2_000),
    sources: z.array(z.url({ protocol: /^https?$/ })).min(1),
  })).min(1).refine(
    (options) => new Set(options.map(({ name }) => name.toLocaleLowerCase())).size === options.length,
    "Discovered option names must be distinct",
  ),
})

export type DiscoveryInventory = z.infer<typeof discoveryInventorySchema>

export function parseDiscoveryInventory(text: string): DiscoveryInventory {
  return discoveryInventorySchema.parse(secureJsonParse(text))
}

/** Keeps every option's identity and sources while bounding descriptive context. */
export function formatDiscoveryInventory(
  inventory: DiscoveryInventory,
  maxChars = config.deepSearch.maxSummaryContextChars,
): string {
  return formatBoundedTextEntries(inventory.options.map(({ description, ...identity }) => ({
    opening: `<discovered_option>\n${JSON.stringify(identity)}\n`,
    text: description,
    closing: "\n</discovered_option>",
  })), maxChars)
}

/** Validates a complete inventory before its generation can commit. */
export async function updateDiscoveryInventory(
  input: Pick<TextGenerationPersistenceCallbacks, "onRegistered" | "onFailed" | "onInterrupted"> & {
    userId: string
    deepSearchJobId: string
    researchRequest: string
    previousInventory?: DiscoveryInventory
    searchSummaries: Array<{ round?: number; query: string; content: string }>
    sourceEvidence: SourceEvidence[]
    workflowSignal?: AbortSignal
  },
) {
  const previousOptions = input.previousInventory?.options ?? []
  const inventoryContext = input.previousInventory
    ? formatDiscoveryInventory(input.previousInventory, Math.floor(config.deepSearch.maxSummaryContextChars / 2))
    : ""
  // Earlier discoveries are already in the inventory. Preserve the current
  // catalogues before spending context on their much longer source copies;
  // equal allocation across both can remove option names from every copy.
  const latestRound = input.searchSummaries.reduce((latest, { round }) => Math.max(latest, round ?? 0), 0)
  const summaries = input.searchSummaries.filter(({ round }) => (round ?? 0) === latestRound)
  const evidenceBudget = config.deepSearch.maxSummaryContextChars - inventoryContext.length
  const sourceMetadataChars = input.sourceEvidence.reduce(
    (total, source) => total + getSourceParts(source).fixedChars,
    Math.max(0, input.sourceEvidence.length - 1) * 2,
  )
  const separator = summaries.length > 0 && input.sourceEvidence.length > 0 ? "\n\n" : ""
  const summaryContext = formatSearchSummaryContext(summaries, evidenceBudget - sourceMetadataChars - separator.length)
  const sourceContext = formatSearchSummaryContext([], evidenceBudget - summaryContext.length - separator.length,
    input.sourceEvidence, input.researchRequest,
  )
  const evidenceContext = summaryContext + separator + sourceContext
  const sourceUrls = new Set([
    ...input.sourceEvidence.filter(({ evidenceType }) => evidenceType !== "unavailable").map(({ url }) => url),
    ...previousOptions.flatMap(({ sources }) => sources),
  ].map(canonicalUrl))
  const isSuppliedSource = (url: string) => {
    try {
      return sourceUrls.has(canonicalUrl(url))
    } catch {
      return false
    }
  }
  const schema = discoveryInventorySchema.superRefine(({ options }, context) => {
    for (const [index, previous] of previousOptions.entries()) {
      const next = options[index]
      if (next?.name !== previous.name) {
        context.addIssue({ code: "custom", path: ["options", index], message: "Retain every previous option's exact name and position" })
      }
      if (next && previous.sources.some((url) => !next.sources.some((source) => canonicalUrl(source) === canonicalUrl(url)))) {
        context.addIssue({ code: "custom", path: ["options", index, "sources"], message: "Retain every previous option source" })
      }
    }
    for (const [index, option] of options.entries()) {
      if (option.sources.some((url) => !isSuppliedSource(url))) {
        context.addIssue({ code: "custom", path: ["options", index, "sources"], message: "Option sources must come from the supplied research" })
      }
    }
  })
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { deepSearchJobId: input.deepSearchJobId },
    promptName: PromptName.UpdateDiscoveryInventory,
    prompt: [
      "<user_request>", input.researchRequest, "</user_request>",
      "<previous_inventory>", inventoryContext, "</previous_inventory>",
      "<research_evidence>", evidenceContext, "</research_evidence>",
    ].join("\n"),
    schema,
    workflowSignal: input.workflowSignal,
    onRegistered: input.onRegistered,
    onFailed: input.onFailed,
    onInterrupted: input.onInterrupted,
  })
  return {
    streamId: generation.id,
    answer: awaitGenerationOutput(generation, generation.output)
      .then(() => awaitGenerationText(generation)),
    completion: generation.completion,
  }
}
