import type { APIRequestContext } from "@playwright/test"
import Database from "better-sqlite3"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "./fixtures.ts"
import type { TextStreamEvent } from "../lib/textStreams.ts"
import type { DebateTournamentSnapshot } from "../lib/debateJobs.ts"

type CreditAccount = { credits: number; isAdmin: boolean }
type StructuredGeneration = {
  creditsUsed: number | null
  modelId: string | null
  promptName: string | null
  status: string
  text: string | null
}

function parseEvents(body: string): TextStreamEvent[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TextStreamEvent)
}

async function getCredits(request: APIRequestContext): Promise<number> {
  const response = await request.get("/api/credits")
  expect(response.status()).toBe(200)
  return ((await response.json()) as CreditAccount).credits
}

function getStructuredGenerations(
  startedAt: number,
  deepSearchJobId: string,
): StructuredGeneration[] {
  const candidates = readdirSync(tmpdir())
    .filter(
      (name) => name.startsWith("rethinkloop-e2e-") && name.endsWith(".db"),
    )
    .map((name) => join(tmpdir(), name))

  for (const candidate of candidates) {
    let database: Database.Database | undefined
    try {
      database = new Database(candidate, { fileMustExist: true, readonly: true })
      const job = database
        .prepare(
          "select 1 from deep_search_jobs where deep_search_job_id = ?",
        )
        .get(deepSearchJobId)
      if (!job) continue
      return database
        .prepare(
          `select credits_used as creditsUsed, model_id as modelId,
                  prompt_name as promptName, status, text
             from llm_generations
            where started_at >= ?
              and (prompt_name = 'generate-prompt-title'
                   or (prompt_name = 'generate-websearch-queries'
                       and deep_search_job_id = ?))
            order by prompt_name`,
        )
        .all(startedAt, deepSearchJobId) as StructuredGeneration[]
    } catch {
      // Other E2E processes may remove their temporary database concurrently.
    } finally {
      database?.close()
    }
  }
  return []
}

function getDebateGenerations(debateJobId: string): StructuredGeneration[] {
  const candidates = readdirSync(tmpdir())
    .filter((name) => name.startsWith("rethinkloop-e2e-") && name.endsWith(".db"))
  for (const candidate of candidates) {
    let database: Database.Database | undefined
    try {
      database = new Database(join(tmpdir(), candidate), {
        fileMustExist: true,
        readonly: true,
      })
      if (!database.prepare("select 1 from debate_jobs where debate_job_id = ?").get(debateJobId)) {
        continue
      }
      return database.prepare(
        `select credits_used as creditsUsed, model_id as modelId,
                prompt_name as promptName, status, text
         from llm_generations
         where debate_job_id = @debateJobId
            or idea_job_id in (
              select idea_job_id from idea_jobs where debate_job_id = @debateJobId
            )
            or deep_search_job_id in (
              select d.deep_search_job_id from deep_search_jobs d
              join idea_jobs i on i.idea_job_id = d.idea_job_id
              where i.debate_job_id = @debateJobId
            )`,
      ).all({ debateJobId }) as StructuredGeneration[]
    } catch {
      // Other E2E processes may remove their temporary database concurrently.
    } finally {
      database?.close()
    }
  }
  return []
}

async function runStandaloneStream(
  request: APIRequestContext,
  prompt: string,
): Promise<{ id: string; events: TextStreamEvent[]; text: string }> {
  const created = await request.post("/api/streams", {
    data: { prompt },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }

  const streamed = await request.get(`/api/streams/${id}`)
  expect(streamed.status()).toBe(200)
  expect(streamed.headers()["content-type"]).toContain(
    "application/x-ndjson",
  )
  const events = parseEvents(await streamed.text())
  expect(events.at(-1)).toEqual({ type: "done" })
  expect(events.some((event) => event.type === "error")).toBe(false)
  return {
    id,
    events,
    text: events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join(""),
  }
}

test("connects ChatGPT, uses Codex without credits, and falls back after disconnect", async ({
  page,
  request,
}) => {
  test.setTimeout(30_000)
  await page.goto("/settings")

  await expect(
    page.getByRole("heading", { name: "OpenAI subscription" }),
  ).toBeVisible()
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Connect OpenAI" }).click()
  await expect(
    page.getByRole("heading", { name: "Finish connecting with OpenAI" }),
  ).toBeVisible()
  await expect(page.getByText("E2E-CODE", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Open OpenAI verification" }),
  ).toHaveAttribute("href", "https://auth.openai.com/codex/device")

  await expect(
    page.getByRole("heading", { name: "OpenAI is connected" }),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole("combobox", { name: "Small model" }).click()
  await page
    .getByRole("option", { name: "GPT-5.6 Sol — OpenAI" })
    .click()
  await page.getByRole("combobox", { name: "Big model" }).click()
  await page
    .getByRole("option", { name: "GPT-5.6 Luna — OpenAI" })
    .click()
  await page.getByRole("button", { name: "Save model choices" }).click()
  await expect(page.getByText("Model choices saved.")).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "OpenAI is connected" }),
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Small model" }),
  ).toContainText("GPT-5.6 Sol — OpenAI")
  await expect(
    page.getByRole("combobox", { name: "Big model" }),
  ).toContainText("GPT-5.6 Luna — OpenAI")

  const creditsBeforeCodex = await getCredits(request)
  const codex = await runStandaloneStream(
    request,
    "[E2E_CODEX_SUBSCRIPTION] Answer through the connected subscription.",
  )
  expect(codex.text).toBe("E2E Codex subscription response.")
  expect(codex.events.some((event) => event.type === "reasoning")).toBe(true)
  expect(await getCredits(request)).toBe(creditsBeforeCodex)

  const structuredStartedAt = Date.now()
  await page.goto("/deep-search")
  const createdJob = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/deep-search-jobs",
  )
  const researchRequest =
    "[E2E_CODEX_STRUCTURED] Generate one deterministic search query."
  await page.getByLabel("Research request").fill(researchRequest)
  await page.getByRole("button", { name: "Start deep search" }).click()

  const created = await createdJob
  expect(created.status()).toBe(202)
  expect(created.request().postDataJSON()).toEqual({ researchRequest })
  const { deepSearchJobId } = (await created.json()) as {
    deepSearchJobId: string
  }
  await expect(
    page.getByRole("heading", { name: "E2E Codex Structured Title" }),
  ).toBeVisible()

  await expect
    .poll(
      () => {
        const generations = getStructuredGenerations(
          structuredStartedAt,
          deepSearchJobId,
        )
        return (
          generations.length === 2 &&
          generations.every(
            (generation) =>
              generation.status === "completed" &&
              generation.creditsUsed === 0,
          )
        )
      },
      { intervals: [10, 20, 50], timeout: 10_000 },
    )
    .toBe(true)
  const cancellation = await request.post(
    `/api/deep-search-jobs/${deepSearchJobId}/cancel`,
  )
  expect(cancellation.status()).toBe(202)
  await expect(page.getByText("Workflow stopped by user")).toBeVisible()
  expect(
    getStructuredGenerations(
      structuredStartedAt,
      deepSearchJobId,
    ),
  ).toEqual([
    {
      creditsUsed: 0,
      modelId: "gpt-5.6-sol",
      promptName: "generate-prompt-title",
      status: "completed",
      text: '{"title":"E2E Codex Structured Title"}',
    },
    {
      creditsUsed: 0,
      modelId: "gpt-5.6-luna",
      promptName: "generate-websearch-queries",
      status: "completed",
      text: '{"version":1,"requirements":[],"queries":["E2E Codex structured query 1","E2E Codex structured query 2","E2E Codex structured query 3"]}',
    },
  ])

  await page.goto("/settings")
  await page.getByRole("button", { name: "Disconnect OpenAI" }).click()
  const dialog = page.getByRole("dialog", { name: "Disconnect OpenAI?" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Small model" }),
  ).toContainText("DeepSeek V4 Flash")
  await expect(
    page.getByRole("combobox", { name: "Big model" }),
  ).toContainText("DeepSeek V4 Pro")

  const creditsBeforeFallback = await getCredits(request)
  const fallback = await runStandaloneStream(
    request,
    "[E2E_STANDALONE_DEEPSEEK] Answer through the server fallback.",
  )
  expect(fallback.text).toBe("E2E DeepSeek fallback response.")
  expect(await getCredits(request)).toBeLessThan(creditsBeforeFallback)

  const retried = await runStandaloneStream(
    request,
    `[E2E_RETRY_DEEPSEEK] ${crypto.randomUUID()}`,
  )
  expect(retried.text).toBe("E2E DeepSeek retry response.")
})

test.describe("OpenAI debate", () => {
  let createdDebate: { debateJobId: string; slug: string } | undefined

  test.afterEach(async ({ request }) => {
    try {
      if (createdDebate) {
        const { debateJobId, slug } = createdDebate
        const detail = await request.get(`/api/debate-jobs/${slug}`)
        expect(detail.status()).toBe(200)
        const { debateJob } = await detail.json() as { debateJob: DebateTournamentSnapshot }
        if (debateJob.status === "running") {
          const cancelled = await request.post(`/api/debate-jobs/${debateJobId}/cancel`)
          expect([200, 202, 409]).toContain(cancelled.status())
        }
        // The terminal event follows settlement of the debate's active children.
        const settled = await request.get(`/api/debate-jobs/${debateJobId}/events`, {
          timeout: 20_000,
        })
        expect(settled.status()).toBe(200)
        expect(parseEvents(await settled.text()).at(-1)).toEqual({ type: "done" })
        expect(getDebateGenerations(debateJobId).some((generation) => generation.status === "running"))
          .toBe(false)
      }
    } finally {
      createdDebate = undefined
      const disconnected = await request.delete("/api/openai-connection")
      expect(disconnected.status()).toBe(200)
      expect(await disconnected.json()).toEqual({ status: "disconnected" })
    }
  })

  test("completes an OpenAI debate through research, all 23 matches, and the winner website", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(10_000)
    await page.goto("/settings")
    await page.getByRole("button", { name: "Connect OpenAI" }).click()
    await expect(page.getByText("E2E-CODE", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "OpenAI is connected" }),
    ).toBeVisible({ timeout: 10_000 })
    await page.getByRole("combobox", { name: "Small model" }).click()
    await page.getByRole("option", { name: "GPT-5.6 Luna — OpenAI" }).click()
    await page.getByRole("combobox", { name: "Big model" }).click()
    await page.getByRole("option", { name: "GPT-5.6 Sol — OpenAI" }).click()
    // Persist an explicit choice even when the displayed recommendations match.
    await page.getByRole("combobox", { name: "Small reasoning" }).click()
    await page.getByRole("option", { name: "High", exact: true }).click()
    await page.getByRole("button", { name: "Save model choices" }).click()
    await expect(page.getByText("Model choices saved.")).toBeVisible()
    await page.getByRole("combobox", { name: "Small reasoning" }).click()
    await page.getByRole("option", { name: "Medium (Recommended)", exact: true }).click()
    await page.getByRole("button", { name: "Save model choices" }).click()
    await expect(page.getByText("Model choices saved.")).toBeVisible()
    await page.reload()
    await expect(page.getByRole("combobox", { name: "Small model" }))
      .toContainText("GPT-5.6 Luna — OpenAI")
    await expect(page.getByRole("combobox", { name: "Small reasoning" }))
      .toContainText("Medium")
    await expect(page.getByRole("combobox", { name: "Big model" }))
      .toContainText("GPT-5.6 Sol — OpenAI")
    await expect(page.getByRole("combobox", { name: "Big reasoning" }))
      .toContainText("Extra high")

    const streamRequests: string[] = []
    const eventRequests: string[] = []
    page.on("request", (browserRequest) => {
      const path = new URL(browserRequest.url()).pathname
      if (/^\/api\/streams\/[^/]+$/.test(path)) streamRequests.push(path)
      if (/^\/api\/debate-jobs\/[^/]+\/events$/.test(path)) eventRequests.push(path)
    })
    await page.goto("/debates")
    const prompt = "Design a practical product that helps small apartment buildings reduce energy use without installing new hardware, changing utility providers, or adding substantial work for residents or building managers."
    const createdResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/debate-jobs"
    )
    await page.getByLabel("What should the ideas solve?").fill(prompt)
    await page.getByRole("button", { name: "Start a debate" }).click()
    const created = await createdResponse
    expect(created.status()).toBe(202)
    const { debateJobId, slug } = await created.json() as {
      debateJobId: string
      slug: string
    }
    createdDebate = { debateJobId, slug }
    await expect(page).toHaveURL(new RegExp(`/debates/${slug}$`))
    await expect(page.getByText("Debate in progress")).toBeVisible()
    const debateUrl = page.url()
    const liveMatch = page.getByRole("link", { name: /^Open .+ versus .+$/ })
      .filter({ has: page.getByText("Live", { exact: true }) }).first()
    await expect(liveMatch).toBeVisible({ timeout: 40_000 })
    await liveMatch.click()
    const transcript = page.getByRole("log", { name: "Debate messages" })
    await expect(page.getByText("Streaming", { exact: true })).toBeVisible()
    await expect(transcript).toContainText("makes the stronger opening case")
    await page.reload()
    await expect(transcript).toContainText("makes the stronger opening case")
    expect(streamRequests.length).toBeGreaterThan(0)
    expect(eventRequests.length).toBeGreaterThan(1)
    await page.goto(debateUrl)
    await expect(page.getByText("Debate complete", { exact: true }))
      .toBeVisible({ timeout: 90_000 })
    await expect(page.getByText("Winning idea", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Improved Renter Energy Idea 1", exact: true }))
      .toBeVisible()
    await expect(page.getByRole("region", { name: "Debate progress" })).toHaveCount(0)

    const detail = await request.get(`/api/debate-jobs/${slug}`)
    expect(detail.status()).toBe(200)
    const { debateJob } = await detail.json() as { debateJob: DebateTournamentSnapshot }
    expect(debateJob).toMatchObject({
      debateJobId,
      status: "completed",
      stage: "final",
      expectedMatchCount: 23,
      error: null,
    })
    expect(debateJob.rounds.map((round) => round.stage)).toEqual([
      "swiss", "swiss", "swiss", "swiss", "swiss", "semifinal", "final",
    ])
    const matches = debateJob.rounds.flatMap((round) => round.matches)
    expect(matches).toHaveLength(23)
    for (const match of matches) {
      expect(match.status).toBe("completed")
      expect(match.messages).toHaveLength(5)
      expect(match.messages.map((message) => message.position)).toEqual([0, 1, 2, 3, 4])
      expect(match.messages[4]?.text).toContain("wins because")
    }
    const terminalEvents = await request.get(`/api/debate-jobs/${debateJobId}/events`)
    expect(parseEvents(await terminalEvents.text())).toEqual([
      { type: "updated" }, { type: "done" },
    ])
    const website = await request.get(
      `/api/idea-jobs/${debateJob.ideaJobId}/ideas/${debateJob.winnerWebsiteIdeaId}/website`,
    )
    expect(website.status()).toBe(200)
    expect(await website.text()).toContain("Deterministic E2E idea website.")
    const generations = getDebateGenerations(debateJobId)
    const expectedStageCounts = {
      "generate-idea-research-prompts": 1,
      "generate-websearch-queries": 9,
      "correct-research-answer": 9,
      "analyze-research-answer": 9,
      "summarize-idea-research": 1,
      "generate-ideas": 1,
      "select-ideas": 1,
      "refine-idea": 8,
      "evaluate-idea": 8,
      "debate-opening": 46,
      "debate-rebuttal": 46,
      "debate-judge": 23,
      "create-idea-site": 1,
    }
    for (const [promptName, count] of Object.entries(expectedStageCounts)) {
      expect(generations.filter((generation) => generation.promptName === promptName))
        .toHaveLength(count)
    }
    const smallPrompts = new Set([
      "generate-prompt-title", "select-websearch-results", "summarize-web-page",
      "summarize-search-query", "summarize-idea-research",
    ])
    for (const generation of generations) {
      expect(generation).toMatchObject({
        status: "completed",
        creditsUsed: 0,
        modelId: smallPrompts.has(generation.promptName ?? "")
          ? "gpt-5.6-luna" : "gpt-5.6-sol",
      })
    }
    await page.reload()
    await expect(page.getByText("Debate complete", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Improved Renter Energy Idea 1", exact: true }))
      .toBeVisible()
    await page.goto("/settings")
    await page.getByRole("button", { name: "Disconnect OpenAI" }).click()
    await page.getByRole("dialog", { name: "Disconnect OpenAI?" })
      .getByRole("button", { name: "Disconnect", exact: true }).click()
    await expect(page.getByText("Not connected", { exact: true })).toBeVisible()
  })
})
