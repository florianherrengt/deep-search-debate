import { eq } from "drizzle-orm"
import { afterEach, expect, it, vi } from "vitest"

const external = vi.hoisted(() => ({
  webSearch: vi.fn<typeof import("../../web_search/index.ts").webSearch>(),
  webExtract: vi.fn<typeof import("../../web_search/webExtract.ts").webExtract>(),
}))
vi.mock("../../web_search/index.ts", () => ({ webSearch: external.webSearch }))
vi.mock("../../web_search/webExtract.ts", () => ({ webExtract: external.webExtract }))

import { parseDiscoveryInventory } from "../../agents/deep_search/discovery.ts"
import type { DeepSearchEvent } from "../../agents/deep_search/schemas.ts"
import { db } from "../../db/index.ts"
import { deepSearchJobs, ideaJobs, llmGenerations, user } from "../../db/schema/index.ts"
import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { reopenDeepSearchJob } from "./jobLifecycle.ts"
import { runDeepSearchPipeline } from "./pipeline.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"
import { runDeepSearchJob } from "./run.ts"
import type { DeepSearchJobEvent } from "./schemas.ts"
import { loadDeepSearchExecutionSnapshot } from "./store.ts"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("persists two rounds of broader discovery and promotes the cumulative inventory without candidate research", async () => {
  const userId = "test-user-id"
  const ideaJobId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  const researchRequest = "Find options across the running-shoe space."
  const roadUrl = "https://example.com/road"
  const primerUrl = "https://example.com/road-primer"
  const trailUrl = "https://example.com/trail"
  const daily = { name: "Daily trainer", category: "Road shoes", description: "A cushioned everyday road shoe.", sources: [roadUrl] }
  const racer = { name: "Racing flat", category: "Road shoes", description: "A light shoe used for road racing.", sources: [roadUrl] }
  const trail = { name: "Trail runner", category: "Trail shoes", description: "An off-road shoe with a grippy outsole.", sources: [trailUrl] }
  const initialInventory = { options: [daily, racer] }
  const expandedInventory = { options: [daily, racer, trail] }
  const requests: Array<{ stage: string; prompt: string }> = []
  let plannedRounds = 0
  let inventories = 0

  db.insert(ideaJobs).values({
    ideaJobId, userId, workflow: "discovery", slug: `discovery-${ideaJobId}`,
    prompt: researchRequest, stage: "research", numberOfIdeas: 8,
    deepSearchCount: 1, maxSearches: 1, maxResultsPerSearch: 1, maxRounds: 3,
  }).run()
  db.insert(deepSearchJobs).values({
    deepSearchJobId: jobId, userId, ideaJobId, ideaJobPosition: 0,
    slug: `discovery-${jobId}`, researchRequest,
    maxSearches: 1, maxResultsPerSearch: 1, maxRounds: 3, strictQuality: true,
  }).run()
  const creditsBefore = db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits

  external.webSearch.mockImplementation(({ query }) => {
    if (query === "road running shoe categories") return Promise.resolve({
      results: [{ title: "Road shoe categories", shortText: "Daily trainers and racing flats.", link: roadUrl }], creditsUsed: 1,
    })
    if (query === "off-road running shoe approaches") return Promise.resolve({
      results: [{ title: "Off-road alternatives", shortText: "Trail runners broaden the options.", link: trailUrl }], creditsUsed: 1,
    })
    throw new Error(`Unexpected discovery query: ${query}`)
  })
  external.webExtract.mockImplementation(({ url }) => {
    if (url !== roadUrl && url !== primerUrl && url !== trailUrl) throw new Error(`Unexpected page: ${url}`)
    return Promise.resolve({ url, content: url === trailUrl ? trail.description : `${daily.description} ${racer.description}`,
      links: url === roadUrl ? [{ url: primerUrl, title: "Road shoe approaches explained" }] : [],
      retrievalMethod: "scrapingant-http", scrapingAntCredits: 1 })
  })
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    expect(request.url).toBe("https://api.deepseek.com/chat/completions")
    const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> }
    const system = payload.messages.find(({ role }) => role === "system")!.content
    const prompt = payload.messages.find(({ role }) => role === "user")!.content
    const stage = system.split("\n")[0]
    requests.push({ stage, prompt })
    let output: unknown
    if (stage === "You plan broad web searches to discover an option space.") {
      output = { version: 1, requirements: [], queries: [plannedRounds++ === 0
        ? "road running shoe categories" : "off-road running shoe approaches"] }
    } else if (stage === "You select web search results for broad option-space discovery.") {
      const result = JSON.parse(/<search_result>(.*?)<\/search_result>/.exec(prompt)![1]) as { id: string }
      output = { elements: [result.id] }
    } else if (stage === "You select discovered page links for broad option-space discovery.") {
      const links = JSON.parse(/<discovered_links>\n(.*?)\n<\/discovered_links>/.exec(prompt)![1]) as Array<{ id: string }>
      output = { selectedIds: [links[0].id] }
    } else if (stage === "You summarize a web page for broad option-space discovery.") {
      const sourceUrl = /source_url: (\S+)/.exec(prompt)![1]
      output = prompt.includes(`source_url: ${trailUrl}`)
        ? `${trail.name}: ${trail.description} [Source](${trailUrl})`
        : `${daily.name}: ${daily.description} ${racer.name}: ${racer.description} [Source](${sourceUrl})`
    } else if (stage === "You summarize web search results for broad option-space discovery.") {
      output = prompt.includes("search_query: off-road")
        ? `${trail.name}: ${trail.description} [Source](${trailUrl})`
        : `${daily.name} and ${racer.name} are different road approaches. [Source](${roadUrl})`
    } else if (stage === "You maintain a cumulative inventory of discovered options.") {
      output = inventories++ === 0 ? initialInventory : expandedInventory
    } else if (stage === "You review breadth coverage in an option-space discovery run.") {
      output = { version: 1, requirements: [], gaps: inventories === 1
        ? [{ title: "Off-road approaches", description: "The inventory covers only road shoes.", evidenceToFind: "Trail-running shoe categories and experiences" }]
        : [], reason: inventories === 1 ? "Off-road approaches are missing." : "No material searchable coverage gap remains." }
    } else {
      throw new Error(`Unexpected model stage: ${stage}`)
    }
    const text = typeof output === "string" ? output : JSON.stringify(output)
    return new Response([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } })
  }))

  const events: DeepSearchEvent[] = []
  const answer = await runDeepSearchPipeline({ userId, deepSearchJobId: jobId, researchRequest, publish: (event) => events.push(event) })
  const snapshot = loadDeepSearchExecutionSnapshot(jobId)!
  expect(parseDiscoveryInventory(answer)).toEqual(expandedInventory)
  expect(snapshot).toMatchObject({ mode: "discovery", status: "completed", researchAnalysisGeneration: null })
  expect(snapshot.rounds).toHaveLength(2)
  expect(snapshot.rounds.map(({ reviewDecision }) => reviewDecision)).toEqual(["continue", "stop"])
  expect(parseDiscoveryInventory(snapshot.rounds[0].answerGeneration!.text!)).toEqual(initialInventory)
  expect(parseDiscoveryInventory(snapshot.rounds[1].answerGeneration!.text!)).toEqual(expandedInventory)
  expect(snapshot.finalAnswerGeneration?.generationId).toBe(snapshot.rounds[1].answerGeneration?.generationId)
  expect(snapshot.rounds.every(({ queries }) => queries.every(({ status }) => status === "completed"))).toBe(true)
  expect(snapshot.pages).toHaveLength(3)
  expect(snapshot.pages.map(({ status }) => status)).toEqual(["completed", "completed", "completed"])

  const secondPlan = requests.filter(({ stage }) => stage.startsWith("You plan broad web searches"))[1].prompt
  for (const retained of [daily.name, racer.name, roadUrl, "Trail-running shoe categories and experiences"]) expect(secondPlan).toContain(retained)
  expect(secondPlan).not.toContain("<previous_candidate_answer>")
  const secondInventory = requests.filter(({ stage }) => stage.startsWith("You maintain a cumulative inventory"))[1].prompt
  for (const retained of [daily.name, racer.name, roadUrl, trailUrl]) expect(secondInventory).toContain(retained)
  const generations = db.select().from(llmGenerations).where(eq(llmGenerations.deepSearchJobId, jobId)).all()
  expect(generations.every(({ status }) => status === "completed")).toBe(true)
  expect(new Set(generations.map(({ promptName }) => promptName))).toEqual(new Set([
    "generate-discovery-queries", "select-discovery-results", "select-discovery-links",
    "summarize-discovery-page", "summarize-discovery-query", "update-discovery-inventory", "review-discovery-round",
  ]))
  expect(db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits).toBeLessThan(creditsBefore)
  expect(events.filter(({ type }) => type === "round-answer-stream")).toHaveLength(2)
  expect(events).toContainEqual({ type: "final-answer-stream", streamId: snapshot.finalAnswerGeneration!.generationId })
  expect(events.some(({ type }) => type === "research-analysis")).toBe(false)
  const replay = reconstructDeepSearchJobEvents(jobId)!
  expect(replay).toContainEqual({ type: "final-answer-stream", streamId: snapshot.finalAnswerGeneration!.generationId })
  expect(replay.some(({ type }) => type === "research-analysis")).toBe(false)
}, 30_000)

it.each([
  { failure: "malformed inventory JSON", invalidInventory: "{not-json", expectedError: "JSON" },
  { failure: "empty inventory", invalidInventory: { options: [] }, expectedError: "Too small" },
  { failure: "unsupported source", invalidInventory: { options: [{
    name: "Daily trainer", category: "Road shoes", description: "A cushioned everyday shoe.",
    sources: ["https://example.com/unseen"],
  }] }, expectedError: "Option sources must come from the supplied research" },
])("fails closed on $failure and resumes the same discovery job from completed checkpoints", async ({ invalidInventory, expectedError }) => {
  vi.clearAllMocks()
  const userId = "test-user-id"
  const ideaJobId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  const researchRequest = "Map the running-shoe options."
  const sourceUrl = "https://example.com/road"
  const validInventory = { options: [{
    name: "Daily trainer", category: "Road shoes", description: "A cushioned everyday shoe.", sources: [sourceUrl],
  }] }
  const stages: string[] = []
  let inventoryAttempts = 0

  db.insert(ideaJobs).values({
    ideaJobId, userId, workflow: "discovery", slug: `discovery-${ideaJobId}`,
    prompt: researchRequest, stage: "research", numberOfIdeas: 8,
    deepSearchCount: 1, maxSearches: 1, maxResultsPerSearch: 1, maxRounds: 1,
  }).run()
  db.insert(deepSearchJobs).values({
    deepSearchJobId: jobId, userId, ideaJobId, ideaJobPosition: 0,
    slug: `discovery-${jobId}`, researchRequest,
    maxSearches: 1, maxResultsPerSearch: 1, maxRounds: 1, strictQuality: true,
  }).run()
  external.webSearch.mockResolvedValue({
    results: [{ title: "Road shoe categories", shortText: "Daily trainers suit everyday running.", link: sourceUrl }],
    creditsUsed: 1,
  })
  external.webExtract.mockResolvedValue({
    url: sourceUrl, content: "Daily trainers are cushioned everyday road shoes.", links: [],
    retrievalMethod: "scrapingant-http", scrapingAntCredits: 1,
  })
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    expect(request.url).toBe("https://api.deepseek.com/chat/completions")
    const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> }
    const system = payload.messages.find(({ role }) => role === "system")!.content
    const prompt = payload.messages.find(({ role }) => role === "user")!.content
    const stage = system.split("\n")[0]
    stages.push(stage)
    let output: unknown
    if (stage === "You plan broad web searches to discover an option space.") {
      output = { version: 1, requirements: [], queries: ["road running shoe categories"] }
    } else if (stage === "You select web search results for broad option-space discovery.") {
      const result = JSON.parse(/<search_result>(.*?)<\/search_result>/.exec(prompt)![1]) as { id: string }
      output = { elements: [result.id] }
    } else if (stage === "You summarize a web page for broad option-space discovery.") {
      output = `Daily trainer: a cushioned everyday shoe. [Source](${sourceUrl})`
    } else if (stage === "You summarize web search results for broad option-space discovery.") {
      output = `Daily trainer is an everyday road-shoe option. [Source](${sourceUrl})`
    } else if (stage === "You maintain a cumulative inventory of discovered options.") {
      output = inventoryAttempts++ === 0 ? invalidInventory : validInventory
    } else {
      throw new Error(`Unexpected model stage: ${stage}`)
    }
    const text = typeof output === "string" ? output : JSON.stringify(output)
    return new Response([
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } })
  }))

  const firstLog = createReplayableEventLog<DeepSearchJobEvent>()
  await expect(runDeepSearchJob(jobId, userId, firstLog, researchRequest, 1, 1, 1)).rejects.toThrow(expectedError)
  const failed = loadDeepSearchExecutionSnapshot(jobId)!
  expect(failed).toMatchObject({ mode: "discovery", status: "failed", finalAnswerGeneration: null })
  expect(failed.rounds).toHaveLength(1)
  expect(failed.rounds[0].queries[0]).toMatchObject({ status: "completed" })
  expect(failed.pages).toMatchObject([{ url: sourceUrl, status: "completed" }])
  expect(failed.rounds[0].answerGeneration).toMatchObject({ status: "failed" })
  expect(failed.error).toContain(expectedError)
  const completedQuery = structuredClone(failed.rounds[0].queries[0])
  const completedPage = structuredClone(failed.pages[0])
  const failedInventoryGenerationId = failed.rounds[0].answerGeneration!.generationId
  const stagesBeforeResume = [...stages]

  expect(reopenDeepSearchJob({ jobId })).toEqual({ previousStatus: "failed" })
  const resumedLog = createReplayableEventLog<DeepSearchJobEvent>()
  const answer = await runDeepSearchJob(jobId, userId, resumedLog, researchRequest, 1, 1, 1)
  const completed = loadDeepSearchExecutionSnapshot(jobId)!
  expect(parseDiscoveryInventory(answer)).toEqual(validInventory)
  expect(completed).toMatchObject({ mode: "discovery", status: "completed", error: null })
  expect(completed.rounds[0].queries[0]).toEqual(completedQuery)
  expect(completed.pages[0]).toEqual(completedPage)
  expect(completed.rounds[0].answerGeneration).toMatchObject({ status: "completed", text: JSON.stringify(validInventory) })
  expect(completed.rounds[0].answerGeneration!.generationId).not.toBe(failedInventoryGenerationId)
  expect(completed.finalAnswerGeneration?.generationId).toBe(completed.rounds[0].answerGeneration!.generationId)
  expect(external.webSearch).toHaveBeenCalledOnce()
  expect(external.webExtract).toHaveBeenCalledOnce()
  expect(stagesBeforeResume.filter((stage) => stage === "You maintain a cumulative inventory of discovered options.")).toHaveLength(1)
  expect(stages.slice(stagesBeforeResume.length)).toEqual(["You maintain a cumulative inventory of discovered options."])
  expect(db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, failedInventoryGenerationId)).get()).toMatchObject({ status: "failed" })
  expect(reconstructDeepSearchJobEvents(jobId)).toContainEqual({ type: "final-answer-stream", streamId: completed.finalAnswerGeneration!.generationId })
}, 30_000)
