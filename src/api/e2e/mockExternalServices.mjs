import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

globalThis.AI_SDK_LOG_WARNINGS = false

const databasePath = join(
  tmpdir(),
  `rethinkloop-e2e-${process.pid}.db`,
)
const databaseFiles = [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]
for (const path of databaseFiles) rmSync(path, { force: true })

process.env.DATABASE_URL = databasePath
const sqlite = new Database(databasePath)
migrate(drizzle(sqlite), {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
})
sqlite.close()
let cleanupComplete = false
function cleanupTestFiles() {
  if (cleanupComplete) return
  cleanupComplete = true
  for (const path of databaseFiles) rmSync(path, { force: true })
}
process.once("exit", cleanupTestFiles)
process.once("SIGINT", () => {
  cleanupTestFiles()
  process.exit(130)
})
process.once("SIGTERM", () => {
  cleanupTestFiles()
  process.exit(143)
})

const ideaResearchPrompts = [
  {
    title: "London Renter Energy Constraints",
    prompt: "Research the main energy constraints faced by London renters.",
  },
  {
    title: "Renter-Friendly Energy Interventions",
    prompt: "Research proven renter-friendly household energy interventions.",
  },
]
const debateResearchPrompts = [
  {
    title: "London Renter Energy Constraints",
    prompt:
      "Research the main energy constraints and proven renter-friendly interventions for London renters.",
  },
]

const ideas = Array.from({ length: 8 }, (_, index) => ({
  title: `Renter Energy Idea ${index + 1}`,
  description: `A concrete renter-friendly energy product concept ${index + 1}, grounded in the combined mock research evidence.`,
}))
const refinedIdeas = ideas.map((idea, index) => ({
  title: `Improved Renter Energy Idea ${index + 1}`,
  description: `${idea.description} The improved version adds a specific validation plan and measurable adoption criteria.`,
}))

const debatePrompt =
  "Design a practical product that helps small apartment buildings reduce energy use without installing new hardware, changing utility providers, or adding substantial work for residents or building managers."
const researchBriefing =
  "London renters face insulation, heating-control, and permission constraints. Removable controls and draught-proofing provide practical intervention opportunities."
const deepSearchAnswers = [
  "London renters face insulation, heating-control, and landlord-permission constraints. Removable heating controls and draught-proofing are practical renter-friendly interventions.",
]
const debateFailureMarker = "[E2E_FAIL_DEBATE_OPENING:"
const debateFailureMessage = "Injected debate opening failure"
const debateFailureCandidateOrdinal = 8
const debateFailureAttempts = new Map()

function parseTaggedJson(text, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  if (!match) throw new Error(`Debate request did not include <${tag}>`)
  return JSON.parse(match[1])
}

function taggedText(text, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  if (!match) throw new Error(`Debate request did not include <${tag}>`)
  return match[1].trim()
}

function firstSearchResultId(text) {
  const match = /<search_result>([\s\S]*?)<\/search_result>/.exec(text)
  if (!match) {
    throw new Error("Search selection request did not include a result record")
  }
  const result = JSON.parse(match[1])
  if (!result || typeof result !== "object" || typeof result.id !== "string") {
    throw new Error("Search selection request did not include a result ID")
  }
  return result.id
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object`)
  }
  const actualKeys = Object.keys(value).sort()
  const allowedKeys = [...expectedKeys].sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(allowedKeys)) {
    throw new Error(
      `${label} contained unexpected fields: ${actualKeys.join(", ")}`,
    )
  }
}

function assertDebateContext(user) {
  const context = parseTaggedJson(user, "debate_context")
  assertExactKeys(
    context,
    ["userRequest", "researchBriefing", "deepSearchResults"],
    "Debate context",
  )
  if (
    typeof context.userRequest !== "string" ||
    !context.userRequest.includes(debatePrompt)
  ) {
    throw new Error("Debate request did not preserve the original user prompt")
  }
  if (context.researchBriefing !== researchBriefing) {
    throw new Error("Debate request did not include the research briefing")
  }
  const answers = context.deepSearchResults?.map((result) => result.answer)
  if (
    !Array.isArray(answers) ||
    answers.length !== deepSearchAnswers.length ||
    deepSearchAnswers.some((answer) => !answers.includes(answer))
  ) {
    throw new Error("Debate request did not include both deep-search answers")
  }
  for (const result of context.deepSearchResults) {
    assertExactKeys(
      result,
      ["researchRequest", "answer"],
      "Deep-search result",
    )
  }
  return context
}

function assertCurrentMatchOnly(user, firstOrdinal, secondOrdinal) {
  const currentOrdinals = new Set([firstOrdinal, secondOrdinal])
  const suppliedOrdinals = new Set(
    [...user.matchAll(/Renter Energy Idea (\d+)/g)].map((match) =>
      Number(match[1]),
    ),
  )
  if (
    suppliedOrdinals.size !== currentOrdinals.size ||
    [...suppliedOrdinals].some((ordinal) => !currentOrdinals.has(ordinal))
  ) {
    throw new Error("Debate request leaked an idea from another match")
  }
  if (/"(?:elo|wins|rank|rating|standings|position)"\s*:/i.test(user)) {
    throw new Error("Debate request leaked tournament metadata")
  }
}

function assertDebateAgentInput(system, user) {
  const context = assertDebateContext(user)
  const candidate = parseTaggedJson(user, "assigned_candidate")
  const opponent = parseTaggedJson(user, "opponent_candidate")
  assertExactKeys(
    candidate,
    ["ideaId", "title", "description"],
    "Assigned candidate",
  )
  assertExactKeys(
    opponent,
    ["ideaId", "title", "description"],
    "Opponent candidate",
  )
  const candidateOrdinal = debateIdeaOrdinal(user, 0)
  const opponentOrdinal = debateIdeaOrdinal(user, 1)
  const candidateResearch = parseTaggedJson(
    user,
    "assigned_candidate_research",
  )
  if (
    candidateOrdinal === undefined ||
    opponentOrdinal === undefined ||
    candidateOrdinal === opponentOrdinal ||
    candidate.title !== `Improved Renter Energy Idea ${candidateOrdinal}` ||
    opponent.title !== `Improved Renter Energy Idea ${opponentOrdinal}`
  ) {
    throw new Error("Debate advocate request did not include both current ideas")
  }
  assertExactKeys(
    candidateResearch,
    ["researchRequest", "answer"],
    "Assigned candidate research",
  )
  if (
    !candidateResearch.researchRequest.includes(
      `Improved Renter Energy Idea ${candidateOrdinal}`,
    ) ||
    !candidateResearch.answer.includes(
      `Improved Renter Energy Idea ${candidateOrdinal}`,
    )
  ) {
    throw new Error("Debate advocate did not receive its own candidate research")
  }
  if (user.includes("<candidate_a_research>") || user.includes("<candidate_b_research>")) {
    throw new Error("Debate advocate received judge-only research tags")
  }
  assertCurrentMatchOnly(user, candidateOrdinal, opponentOrdinal)

  const isRebuttal = /rebuttal|rebut/i.test(system)
  if (isRebuttal) {
    const ownOpening = taggedText(user, "assigned_candidate_opening")
    const opponentOpening = taggedText(user, "opponent_opening")
    if (
      !ownOpening.includes("makes the stronger opening case") ||
      !opponentOpening.includes("makes the stronger opening case")
    ) {
      throw new Error("Debate rebuttal did not receive both opening arguments")
    }
  } else if (
    user.includes("<assigned_candidate_opening>") ||
    user.includes("<opponent_opening>")
  ) {
    throw new Error("Debate opening received transcript memory")
  }

  return { context, candidateOrdinal, isRebuttal }
}

function assertDebateJudgeInput(user) {
  assertDebateContext(user)
  const first = parseTaggedJson(user, "candidate_a")
  const second = parseTaggedJson(user, "candidate_b")
  const firstResearch = parseTaggedJson(user, "candidate_a_research")
  const secondResearch = parseTaggedJson(user, "candidate_b_research")
  const transcript = parseTaggedJson(user, "transcript")
  assertExactKeys(
    first,
    ["ideaId", "title", "description"],
    "Candidate A",
  )
  assertExactKeys(
    second,
    ["ideaId", "title", "description"],
    "Candidate B",
  )
  if (Array.isArray(transcript)) {
    for (const entry of transcript) {
      assertExactKeys(entry, ["speaker", "message"], "Transcript entry")
    }
  }
  const firstOrdinal = debateIdeaOrdinal(user, 0)
  const secondOrdinal = debateIdeaOrdinal(user, 1)
  if (
    firstOrdinal === undefined ||
    secondOrdinal === undefined ||
    first.title !== `Improved Renter Energy Idea ${firstOrdinal}` ||
    second.title !== `Improved Renter Energy Idea ${secondOrdinal}`
  ) {
    throw new Error("Debate judge request did not include Candidate A and B")
  }
  for (const [research, ordinal] of [
    [firstResearch, firstOrdinal],
    [secondResearch, secondOrdinal],
  ]) {
    assertExactKeys(
      research,
      ["researchRequest", "answer"],
      "Candidate research",
    )
    if (
      !research.researchRequest.includes(
        `Improved Renter Energy Idea ${ordinal}`,
      ) ||
      !research.answer.includes(`Improved Renter Energy Idea ${ordinal}`)
    ) {
      throw new Error("Debate judge did not receive both candidate reports")
    }
  }
  if (
    !Array.isArray(transcript) ||
    transcript.length !== 4 ||
    transcript.filter(({ speaker }) => speaker === "Candidate A").length !== 2 ||
    transcript.filter(({ speaker }) => speaker === "Candidate B").length !== 2 ||
    transcript.filter(({ message }) =>
      message.includes("makes the stronger opening case"),
    ).length !== 2 ||
    transcript.filter(({ message }) =>
      message.includes("answers the opposing case"),
    ).length !== 2
  ) {
    throw new Error("Debate judge did not receive the complete current transcript")
  }
  assertCurrentMatchOnly(user, firstOrdinal, secondOrdinal)
  return { firstOrdinal, secondOrdinal }
}

function debateIdeaOrdinal(text, slot) {
  const ownLabel =
    slot === 0
      ? /candidate[_\s-]*A\b|assigned_candidate/i
      : /candidate[_\s-]*B\b|opponent_candidate/i
  const otherLabel =
    slot === 0
      ? /candidate[_\s-]*B\b|opponent_candidate/i
      : /candidate[_\s-]*A\b|assigned_candidate/i
  const start = text.search(ownLabel)
  if (start >= 0) {
    const remainder = text.slice(start)
    const otherStart = remainder.search(otherLabel)
    const section = otherStart > 0 ? remainder.slice(0, otherStart) : remainder
    const ordinal = /Renter Energy Idea (\d+)/.exec(section)?.[1]
    if (ordinal) return Number(ordinal)
  }

  const ordinals = [...text.matchAll(/Renter Energy Idea (\d+)/g)].map((match) =>
    Number(match[1]),
  )
  return ordinals[slot]
}

function debateAgentOutput(system, user) {
  const { candidateOrdinal: ordinal, isRebuttal } = assertDebateAgentInput(
    system,
    user,
  )
  const title = `Improved Renter Energy Idea ${ordinal}`

  return {
    reasoning: `Build a concise mock ${isRebuttal ? "rebuttal" : "opening"} for idea ${ordinal}.`,
    text: isRebuttal
      ? `${title} answers the opposing case: its measurable, renter-friendly workflow produces value without hardware or extra management overhead.`
      : `${title} makes the stronger opening case because it turns the research constraints into a practical, measurable product with no installation burden.`,
    delayMs: 20,
    secondTextDelayMs: 350,
  }
}

function debateJudgeOutput(user) {
  const { firstOrdinal, secondOrdinal } = assertDebateJudgeInput(user)

  const winnerSlot = firstOrdinal < secondOrdinal ? 0 : 1
  const winnerOrdinal = Math.min(firstOrdinal, secondOrdinal)
  return {
    reasoning: `Compare both complete mock transcripts and select idea ${winnerOrdinal}.`,
    text: JSON.stringify({
      winnerSlot,
      explanation: `Renter Energy Idea ${winnerOrdinal} wins because it is the more direct, measurable response to the researched constraints.`,
    }),
    delayMs: 20,
    secondTextDelayMs: 350,
  }
}

function messageText(body, role) {
  return body.messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join("\n")
}

function researchAngle(userMessage) {
  const refinedIdeaOrdinal = /Improved Renter Energy Idea (\d+)/.exec(
    userMessage,
  )?.[1]
  if (refinedIdeaOrdinal) return `idea-${refinedIdeaOrdinal}`
  const researchRequest = /^user_query:\s*(.*)$/m.exec(userMessage)?.[1]
  const source = researchRequest ?? userMessage
  if (source.includes("constraints and proven renter-friendly interventions")) {
    return "combined"
  }
  return source.includes("interventions")
    ? "interventions"
    : "constraints"
}

function assertThinkingMode(body, system) {
  const roundReviewUsesReasoning = system.includes(
    "You decide whether a deep-research job",
  )
  const budgetSensitiveTextSkipsReasoning =
    system.includes("Evaluate the generated idea against") ||
    system.includes("Combine the supplied research texts") ||
    system.includes("You summarize an extracted web page") ||
    system.includes("You summarize the results returned for one web search") ||
    system.includes("You write the current candidate answer for a deep research run") ||
    /debate|opening argument|rebuttal/i.test(system)
  // These bounded prose stages deliberately bypass Flash thinking because it
  // can consume the entire output budget without emitting the required text.
  // Keep this assertion strict so E2E catches accidental re-enabling later.
  const expected =
    budgetSensitiveTextSkipsReasoning ||
    (body.response_format && !roundReviewUsesReasoning)
      ? "disabled"
      : "enabled"
  if (body.thinking?.type !== expected) {
    throw new Error(
      `Expected DeepSeek thinking=${expected} for ${body.response_format ? "structured" : "text"} output`,
    )
  }
}

function deepSeekOutput(body) {
  const system = messageText(body, "system")
  const user = messageText(body, "user")
  assertThinkingMode(body, system)

  if (system.includes("You create short, descriptive titles")) {
    const title = user.includes("official MDN documentation")
      ? "JavaScript Array Documentation"
      : user.includes("London renters")
        ? "London Renter Energy Products"
        : user.includes("small apartment buildings")
          ? "Apartment Energy Product Ideas"
          : "Saved Research Request"
    return {
      reasoning: "",
      text: JSON.stringify({ title }),
    }
  }

  if (system.includes("You plan research that will help another model")) {
    const isDebate = user.includes(debatePrompt)
    const expectedCount = isDebate ? 1 : 2
    if (!user.includes(`Generate exactly ${expectedCount} deep-search prompts.`)) {
      throw new Error(
        `Idea planning request did not preserve deepSearchCount=${expectedCount}`,
      )
    }
    return {
      reasoning: "Split the request into constraints and proven interventions.",
      text: JSON.stringify({
        elements: isDebate ? debateResearchPrompts : ideaResearchPrompts,
      }),
    }
  }
  if (system.includes("You generate search-engine queries")) {
    const angle = researchAngle(user)
    return {
      reasoning: `Use one focused ${angle} query for the deterministic test.`,
      text: JSON.stringify({
        elements: [`London renter household energy ${angle} evidence`],
      }),
    }
  }
  if (system.includes("You are a search-result selection agent")) {
    return {
      reasoning: "The first result is the primary evidence source.",
      text: JSON.stringify({ elements: [firstSearchResultId(user)] }),
    }
  }
  if (system.includes("You decide whether a deep-research job")) {
    return {
      reasoning: "The deterministic evidence is sufficient for the answer.",
      text: JSON.stringify({
        decision: "stop",
        reason: "The current evidence directly answers the request.",
      }),
    }
  }
  if (system.includes("You summarize an extracted web page")) {
    const angle = researchAngle(user)
    return {
      reasoning: "Extract the concrete finding relevant to the research request.",
      text:
        angle.startsWith("idea-")
          ? `The mock source supports the practical assumptions for Improved Renter Energy Idea ${angle.slice(5)}.`
          : angle === "combined"
          ? "The mock source reports insulation and permission constraints alongside removable heating controls and draught-proofing interventions."
          : angle === "interventions"
          ? "The mock source reports practical removable heating controls and draught-proofing interventions."
          : "The mock source reports insulation, heating-control, and landlord-permission constraints.",
    }
  }
  if (system.includes("You summarize the results returned for one web search")) {
    const angle = researchAngle(user)
    return {
      reasoning: "Combine the selected page with the unselected search snippet.",
      text:
        angle.startsWith("idea-")
          ? `The search validates implementation considerations for Improved Renter Energy Idea ${angle.slice(5)}.`
          : angle === "combined"
          ? "The search found insulation, heating-control, and landlord-permission constraints alongside removable controls and draught-proofing."
          : angle === "interventions"
          ? "The search found removable heating controls and draught-proofing interventions for renters."
          : "The search found insulation, heating-control, and landlord-permission constraints for London renters.",
    }
  }
  if (system.includes("You write the current candidate answer for a deep research run")) {
    const angle = researchAngle(user)
    const text = angle.startsWith("idea-")
      ? `Research specific to Improved Renter Energy Idea ${angle.slice(5)} validates its practical workflow, risks, and measurable pilot criteria.`
      : angle === "combined"
        ? "London renters face insulation, heating-control, and landlord-permission constraints. Removable heating controls and draught-proofing are practical renter-friendly interventions."
      : angle === "interventions"
        ? "Removable heating controls and draught-proofing are practical renter-friendly interventions."
        : "London renters face insulation, heating-control, and landlord-permission constraints."
    return {
      reasoning: "Answer only from the deterministic query summary.",
      text,
    }
  }
  if (system.includes("Combine the supplied research texts")) {
    if (
      !user.includes("insulation, heating-control, and landlord-permission") ||
      !user.includes("Removable heating controls and draught-proofing")
    ) {
      throw new Error("Idea summary request did not include both child final answers")
    }
    return {
      reasoning: "Retain distinct findings from both child final answers.",
      text: researchBriefing,
    }
  }
  if (system.includes("Generate exactly the requested number of distinct")) {
    if (
      !user.includes("Generate exactly 8 ideas.") ||
      !user.includes("Removable controls and draught-proofing")
    ) {
      throw new Error("Idea generation request did not include count and briefing")
    }
    return {
      reasoning:
        "Turn the combined constraints and interventions into eight distinct products.",
      text: JSON.stringify({ elements: ideas }),
    }
  }
  if (system.includes("Evaluate the generated idea against")) {
    const generatedIdea = parseTaggedJson(user, "generated_idea")
    const position = ideas.findIndex(
      (idea) => JSON.stringify(idea) === JSON.stringify(generatedIdea),
    )
    if (
      !user.includes("<research_briefing>") ||
      position === -1
    ) {
      throw new Error("Idea evaluation request did not include its complete context")
    }
    const ordinal = position + 1
    return {
      reasoning:
        "Assess this idea independently against the researched constraints.",
      text: JSON.stringify({
        pros: [
          `Idea ${ordinal} has a clear renter-friendly mechanism.`,
          `Idea ${ordinal} responds directly to the researched constraints.`,
        ],
        cons: [
          `Idea ${ordinal} needs stronger evidence of adoption.`,
          `Idea ${ordinal} needs clearer differentiation from alternatives.`,
        ],
        critique: `Idea ${ordinal} is promising, but it should validate its specific workflow and measurable impact.`,
      }),
    }
  }
  if (system.includes("Select the strongest generated ideas")) {
    const candidates = [...user.matchAll(
      /<evaluated_idea>\s*([\s\S]*?)\s*<\/evaluated_idea>/g,
    )].map((match) => JSON.parse(match[1]))
    if (candidates.length !== ideas.length) {
      throw new Error("Idea selection request omitted evaluated ideas")
    }
    return {
      reasoning: "Select all eight distinct mock candidates for the tournament.",
      text: JSON.stringify({
        selectedIdeaIds: candidates.map(({ ideaId }) => ideaId),
      }),
    }
  }
  if (system.includes("Improve the selected idea using its evaluation")) {
    const originalIdea = parseTaggedJson(user, "original_idea")
    const evaluation = parseTaggedJson(user, "evaluation")
    const position = ideas.findIndex(
      (idea) => JSON.stringify(idea) === JSON.stringify(originalIdea),
    )
    if (
      position === -1 ||
      !evaluation.pros.includes(
        `Idea ${position + 1} has a clear renter-friendly mechanism.`,
      )
    ) {
      throw new Error("Idea refinement request omitted its evaluation or original")
    }
    return {
      reasoning: `Apply the evaluation to mock idea ${position + 1}.`,
      text: JSON.stringify(refinedIdeas[position]),
    }
  }
  if (/independent judge/i.test(system)) {
    return debateJudgeOutput(user)
  }
  if (/debate|opening argument|rebuttal/i.test(system)) {
    return debateAgentOutput(system, user)
  }

  throw new Error("Unhandled DeepSeek request in E2E external-service mock")
}

function deepSeekResponse(body) {
  const output = deepSeekOutput(body)
  const system = messageText(body, "system")
  const user = messageText(body, "user")
  const context = /debate|opening argument|rebuttal/i.test(system)
    ? assertDebateContext(user)
    : undefined
  if (
    context?.userRequest.includes(debateFailureMarker) &&
    !/rebuttal|rebut/i.test(system) &&
    debateIdeaOrdinal(user, 0) === debateFailureCandidateOrdinal
  ) {
    const attempt = (debateFailureAttempts.get(context.userRequest) ?? 0) + 1
    debateFailureAttempts.set(context.userRequest, attempt)
    return Response.json(
      {
        error: {
          message: `${debateFailureMessage} (attempt ${attempt})`,
          type: "server_error",
        },
      },
      { status: 500 },
    )
  }

  const reasoning =
    body.thinking?.type === "enabled" ? output.reasoning : ""

  if (body.stream !== true) {
    return Response.json({
      id: "e2e-completion",
      created: 0,
      model: body.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: output.text,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
      },
    })
  }

  const midpoint = Math.ceil(output.text.length / 2)
  const deltas = [
    ...(reasoning ? [{ reasoning_content: reasoning }] : []),
    { content: output.text.slice(0, midpoint) },
    { content: output.text.slice(midpoint) },
  ]
  const secondTextIndex = reasoning ? 2 : 1
  const chunks = deltas.map((delta, index) => ({
    id: `e2e-completion-${index}`,
    created: 0,
    model: body.model,
    choices: [{ delta, finish_reason: null }],
    usage: {},
  }))
  chunks.push({
    id: "e2e-completion-finish",
    created: 0,
    model: body.model,
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
    },
  })

  const encodedChunks = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ]
  const delayMs = output.delayMs ?? 0
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      for (const [index, chunk] of encodedChunks.entries()) {
        const chunkDelayMs =
          index === secondTextIndex
            ? (output.secondTextDelayMs ?? delayMs)
            : delayMs
        if (chunkDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, chunkDelayMs))
        }
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  })
}

function searXngResponse(url) {
  const query = url.searchParams.get("q") ?? "unknown query"
  const slug = encodeURIComponent(query)
  return Response.json({
    results: [
      {
        title: `Primary evidence for ${query}`,
        url: `https://e2e-content.test/${slug}/primary`,
        content: `Primary search evidence about ${query}.`,
      },
      {
        title: `Secondary evidence for ${query}`,
        url: `https://e2e-content.test/${slug}/secondary`,
        content: `Secondary search evidence about ${query}.`,
      },
    ],
  })
}

function pageResponse(url) {
  const topic = decodeURIComponent(url.pathname.split("/")[1] ?? "research")
  const repeatedEvidence = Array.from(
    { length: 8 },
    () =>
      `Evidence about ${topic}: renters benefit from measurable, removable, low-cost energy interventions.`,
  ).join(" ")
  return new Response(
    `<html><head><title>Mock research source</title></head><body><main><h1>Mock evidence</h1><p>${repeatedEvidence}</p></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

async function scrapingAntResponse(request, url) {
  if (request.method !== "GET" || url.pathname !== "/v2/general") {
    throw new Error(
      `Unexpected ScrapingAnt request: ${request.method} ${url.pathname}`,
    )
  }
  if (request.headers.get("x-api-key") !== "e2e-scrapingant-key") {
    throw new Error("ScrapingAnt request omitted its API key header")
  }

  const target = url.searchParams.get("url")
  if (!target) throw new Error("ScrapingAnt request omitted its target URL")
  const targetUrl = new URL(target)
  if (targetUrl.hostname !== "e2e-content.test") {
    throw new Error(`Unexpected ScrapingAnt target: ${targetUrl.href}`)
  }

  const browser = url.searchParams.get("browser")
  if (browser !== "false" && browser !== "true") {
    throw new Error(`Unexpected ScrapingAnt browser mode: ${browser}`)
  }
  if (
    browser === "true" &&
    (url.searchParams.get("proxy_type") !== "datacenter" ||
      url.searchParams.get("proxy_country") !== "US")
  ) {
    throw new Error("Rendered ScrapingAnt request omitted its US proxy")
  }

  const targetResponse = pageResponse(targetUrl)
  return new Response(await targetResponse.text(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "ant-credits-cost": browser === "false" ? "1" : "10",
    },
  })
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)

  if (url.hostname === "api.deepseek.com") {
    if (request.method !== "POST" || url.pathname !== "/chat/completions") {
      throw new Error(
        `Unexpected DeepSeek request: ${request.method} ${url.pathname}`,
      )
    }
    return deepSeekResponse(await request.json())
  }
  if (url.hostname === "e2e-search.test") {
    return searXngResponse(url)
  }
  if (url.hostname === "api.scrapingant.com") {
    return scrapingAntResponse(request, url)
  }

  throw new Error(`Unmocked outbound E2E request: ${request.method} ${url.href}`)
}
