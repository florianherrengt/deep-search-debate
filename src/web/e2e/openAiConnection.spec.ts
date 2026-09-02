import type { APIRequestContext } from "@playwright/test"
import Database from "better-sqlite3"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "./fixtures.ts"
import type { TextStreamEvent } from "../lib/textStreams.ts"

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
  ).toHaveAttribute("href", "https://auth.openai.com/device")

  await expect(
    page.getByRole("heading", { name: "OpenAI is connected" }),
  ).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "OpenAI is connected" }),
  ).toBeVisible()

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
      modelId: "gpt-e2e-codex",
      promptName: "generate-prompt-title",
      status: "completed",
      text: '{"title":"E2E Codex Structured Title"}',
    },
    {
      creditsUsed: 0,
      modelId: "gpt-e2e-codex",
      promptName: "generate-websearch-queries",
      status: "completed",
      text: '{"elements":["E2E Codex structured query 1","E2E Codex structured query 2","E2E Codex structured query 3"]}',
    },
  ])

  await page.goto("/settings")
  await page.getByRole("button", { name: "Disconnect OpenAI" }).click()
  const dialog = page.getByRole("dialog", { name: "Disconnect OpenAI?" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible()

  const creditsBeforeFallback = await getCredits(request)
  const fallback = await runStandaloneStream(
    request,
    "[E2E_STANDALONE_DEEPSEEK] Answer through the server fallback.",
  )
  expect(fallback.text).toBe("E2E DeepSeek fallback response.")
  expect(await getCredits(request)).toBeLessThan(creditsBeforeFallback)
})
