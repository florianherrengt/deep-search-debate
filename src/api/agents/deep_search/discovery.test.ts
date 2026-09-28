import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))
vi.mock("../../llms/generateText.ts", () => ({ generateObjectStream: mocks.generateObjectStream }))

import { discoveryInventorySchema, formatDiscoveryInventory, updateDiscoveryInventory } from "./discovery.ts"
import { config } from "../../config.ts"
import type { SourceEvidence } from "./searchSummaryContext.ts"

const first = { name: "Daily trainer", category: "Road shoes", description: "A shoe for everyday road running.", sources: ["https://example.com/trainer"] }
const second = { name: "Trail runner", category: "Trail shoes", description: "A shoe for running on trails.", sources: ["https://example.com/trail"] }

describe("discovery inventories", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps every concrete option and citation when descriptive context is bounded", () => {
    const options = Array.from({ length: 40 }, (_, index) => ({
      ...first, name: `Option ${index}`, sources: [`https://example.com/option-${index}`],
      description: "Long description. ".repeat(100),
    }))
    const inventory = discoveryInventorySchema.parse({ options })
    const formatted = formatDiscoveryInventory(inventory, 10_000)
    expect(formatted.length).toBeLessThanOrEqual(10_000)
    expect([...formatted.matchAll(/<discovered_option>/g)]).toHaveLength(40)
    expect(formatted).toContain("[... omitted ...]")
    for (const option of options) {
      expect(formatted).toContain(`"name":"${option.name}"`)
      expect(formatted).toContain(option.sources[0])
    }
    expect(discoveryInventorySchema.safeParse({ options: [] }).success).toBe(false)
    expect(discoveryInventorySchema.safeParse({ options: [first, { ...first, name: "DAILY TRAINER" }] }).success).toBe(false)
    expect(discoveryInventorySchema.safeParse({ options: [{ ...first, sources: [] }] }).success).toBe(false)
  })

  it("accepts broader cumulative coverage while rejecting lost options, reordered identities, lost citations and invented sources", async () => {
    const expanded = { options: [first, second] }
    mocks.generateObjectStream.mockResolvedValue({ id: "inventory-stream", output: Promise.resolve(expanded), completion: Promise.resolve({ status: "completed", text: JSON.stringify(expanded), reasoning: "" }) })
    const generation = await updateDiscoveryInventory({
      userId: "test-user-id", deepSearchJobId: "discovery-job", researchRequest: "What are the best shoes for running?",
      previousInventory: { options: [first] }, searchSummaries: [{ round: 1, query: "trail shoes", content: "Trail shoes are another category." }],
      sourceEvidence: [{ url: second.sources[0], title: "Trail catalogue", content: second.description, evidenceType: "page-summary" }],
    })
    await expect(generation.answer).resolves.toBe(JSON.stringify(expanded))
    const call = mocks.generateObjectStream.mock.calls[0][0] as { schema: ZodType; prompt: string; promptName: string }
    expect(call.promptName).toBe("update-discovery-inventory")
    expect(call.prompt).toContain(first.name)
    expect(call.prompt).toContain(second.sources[0])
    expect(call.schema.parse(expanded)).toEqual(expanded)
    for (const options of [
      [second], [second, first], [{ ...first, sources: [second.sources[0]] }, second],
      [first, { ...second, sources: ["https://invented.example/shoe"] }],
    ]) expect(call.schema.safeParse({ options }).success).toBe(false)
  })

  it("preserves complete current catalogues and prior identities when large duplicate source bodies compete for discovery context", async () => {
    const previousInventory = { options: Array.from({ length: 40 }, (_, index) => ({
      name: `Previous option ${index}`,
      category: "Previously discovered shoes",
      description: "An earlier catalogue description of a running shoe and its general purpose. ".repeat(20),
      sources: [`https://example.com/previous-option-${index}`],
    })) }
    const sourceEvidence: SourceEvidence[] = Array.from({ length: 12 }, (_, index) => ({
      url: `https://example.com/catalogue-${index}`,
      title: `Running shoe catalogue ${index}`,
      evidenceType: index === 11 ? "unavailable" : index >= 8 ? "search-snippet" : "page-summary",
      content: index === 11 ? "Page extraction failed; no page evidence is available."
        : `Catalogue ${index} source body. General information about the different shoes in the catalogue. `.repeat(index < 8 ? 400 : 10),
      ...(index < 8 ? { originalPassages: `Catalogue ${index} original passage about running shoes and general product categories. `.repeat(500) } : {}),
    }))
    const currentSummaries = ["Road", "Trail"].map((category, categoryIndex) => ({
      round: 1,
      query: `${category} running shoe catalogue`,
      content: Array.from({ length: 80 }, (_, index) =>
        `${category} catalogue option ${index}: A ${category.toLowerCase()} running shoe described in the catalogue, with a neutral overview of its general purpose and the available alternatives. [Catalogue source](${sourceEvidence[categoryIndex].url})`,
      ).join("\n"),
    }))
    const searchSummaries = [
      { round: 0, query: "earlier running shoe catalogue", content: "OLDER_ROUND_QUERY_PROSE: previous catalogue discussion already captured in the inventory. ".repeat(800) },
      ...currentSummaries,
      { round: 0, query: "earlier trail shoe catalogue", content: "OLDER_ROUND_QUERY_PROSE: another earlier catalogue discussion. ".repeat(800) },
    ]
    const input = {
      userId: "test-user-id", deepSearchJobId: "discovery-job",
      researchRequest: "What are the best shoes for running?",
      previousInventory, searchSummaries, sourceEvidence,
    }
    const before = structuredClone(input)
    mocks.generateObjectStream.mockResolvedValue({
      id: "inventory-stream", output: Promise.resolve(previousInventory),
      completion: Promise.resolve({ status: "completed", text: JSON.stringify(previousInventory), reasoning: "" }),
    })

    const generation = await updateDiscoveryInventory(input)
    await generation.answer
    const { prompt } = mocks.generateObjectStream.mock.calls[0][0] as { prompt: string }
    const previousContext = /<previous_inventory>\n([\s\S]*?)\n<\/previous_inventory>/.exec(prompt)![1]
    const evidenceContext = /<research_evidence>\n([\s\S]*?)\n<\/research_evidence>/.exec(prompt)![1]

    for (const summary of currentSummaries) expect(evidenceContext).toContain(summary.content)
    expect(evidenceContext).toContain("Road catalogue option 40:")
    expect(evidenceContext).toContain("Trail catalogue option 40:")
    expect(evidenceContext).not.toContain("OLDER_ROUND_QUERY_PROSE")
    for (const option of previousInventory.options) {
      expect(previousContext).toContain(`"name":"${option.name}"`)
      expect(previousContext).toContain(option.sources[0])
    }
    for (const { url, title, evidenceType } of sourceEvidence) {
      expect(evidenceContext).toContain(JSON.stringify({ url, title, evidenceType }))
    }
    expect(previousContext.length + evidenceContext.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars)
    expect(prompt.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars + input.researchRequest.length + 200)
    expect(input).toEqual(before)
  })

  it("retains source provenance when the current catalogue itself needs truncation", async () => {
    const inventory = { options: [first] }
    mocks.generateObjectStream.mockResolvedValue({
      id: "inventory-stream", output: Promise.resolve(inventory),
      completion: Promise.resolve({ status: "completed", text: JSON.stringify(inventory), reasoning: "" }),
    })
    const source = {
      url: first.sources[0], title: "Running shoe catalogue", evidenceType: "page-summary" as const,
      content: "A catalogue of running shoes. ".repeat(400),
      originalPassages: "Original descriptions of the running shoes in the catalogue. ".repeat(400),
    }
    const generation = await updateDiscoveryInventory({
      userId: "test-user-id", deepSearchJobId: "discovery-job", researchRequest: "Discover running shoes.",
      previousInventory: inventory,
      searchSummaries: [{ round: 1, query: "running shoe catalogue", content: "A complete catalogue containing many running shoe options. ".repeat(3_000) }],
      sourceEvidence: [source],
    })
    await generation.answer
    const { prompt } = mocks.generateObjectStream.mock.calls[0][0] as { prompt: string }
    expect(prompt).toContain(JSON.stringify({ url: source.url, title: source.title, evidenceType: source.evidenceType }))
    expect(prompt).toContain(first.name)
    expect(prompt.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars + 200)
  })
})
