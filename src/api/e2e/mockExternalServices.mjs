import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

const databasePath = join(
  tmpdir(),
  `deep-search-debate-e2e-${process.pid}.db`,
)
const databaseFiles = [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]
for (const path of databaseFiles) rmSync(path, { force: true })

process.env.DATABASE_URL = databasePath
const sqlite = new Database(databasePath)
migrate(drizzle(sqlite), {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
})
sqlite.close()
process.once("exit", () => {
  for (const path of databaseFiles) rmSync(path, { force: true })
})

const ideaResearchPrompts = [
  "Research the main energy constraints faced by London renters.",
  "Research proven renter-friendly household energy interventions.",
]

const ideas = Array.from({ length: 12 }, (_, index) => ({
  title: `Renter Energy Idea ${index + 1}`,
  description: `A concrete renter-friendly energy product concept ${index + 1}, grounded in the combined mock research evidence.`,
}))

function messageText(body, role) {
  return body.messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join("\n")
}

function researchAngle(userMessage) {
  const researchRequest = /^user_query:\s*(.*)$/m.exec(userMessage)?.[1]
  return (researchRequest ?? userMessage).includes("interventions")
    ? "interventions"
    : "constraints"
}

function deepSeekOutput(body) {
  const system = messageText(body, "system")
  const user = messageText(body, "user")

  if (system.includes("You plan research that will help another model")) {
    if (!user.includes("Generate exactly 2 deep-search prompts.")) {
      throw new Error("Idea planning request did not preserve deepSearchCount=2")
    }
    return {
      reasoning: "Split the request into constraints and proven interventions.",
      text: JSON.stringify({ elements: ideaResearchPrompts }),
    }
  }
  if (system.includes("You generate search-engine queries")) {
    const angle = user.includes("interventions") ? "interventions" : "constraints"
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
      text: JSON.stringify({ elements: ["result-0"] }),
    }
  }
  if (system.includes("You summarize an extracted web page")) {
    const angle = researchAngle(user)
    return {
      reasoning: "Extract the concrete finding relevant to the research request.",
      text:
        angle === "interventions"
          ? "The mock source reports practical removable heating controls and draught-proofing interventions."
          : "The mock source reports insulation, heating-control, and landlord-permission constraints.",
    }
  }
  if (system.includes("You summarize the results returned for one web search")) {
    const angle = researchAngle(user)
    return {
      reasoning: "Combine the selected page with the unselected search snippet.",
      text:
        angle === "interventions"
          ? "The search found removable heating controls and draught-proofing interventions for renters."
          : "The search found insulation, heating-control, and landlord-permission constraints for London renters.",
    }
  }
  if (system.includes("You are the final-answer agent for a deep research run")) {
    const text =
      researchAngle(user) === "interventions"
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
      text: "London renters face insulation, heating-control, and permission constraints. Removable controls and draught-proofing provide practical intervention opportunities.",
    }
  }
  if (system.includes("Generate exactly the requested number of distinct")) {
    if (
      !user.includes("Generate exactly 12 ideas.") ||
      !user.includes("Removable controls and draught-proofing")
    ) {
      throw new Error("Idea generation request did not include count and briefing")
    }
    return {
      reasoning:
        "Turn the combined constraints and interventions into twelve distinct products.",
      text: JSON.stringify({ elements: ideas }),
    }
  }

  throw new Error("Unhandled DeepSeek request in E2E external-service mock")
}

function deepSeekResponse(body) {
  const output = deepSeekOutput(body)
  const midpoint = Math.ceil(output.text.length / 2)
  const chunks = [
    { reasoning_content: output.reasoning },
    { content: output.text.slice(0, midpoint) },
    { content: output.text.slice(midpoint) },
  ].map((delta, index) => ({
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

  const bodyText = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("")
  return new Response(bodyText, {
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
  if (url.hostname === "e2e-content.test") {
    return pageResponse(url)
  }

  throw new Error(`Unmocked outbound E2E request: ${request.method} ${url.href}`)
}
