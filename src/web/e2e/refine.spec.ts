import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { APIRequestContext, Page } from "@playwright/test"

import { expect, test } from "./fixtures.ts"

type RefineAnswer = {
  questionId: string
  selectedCandidateIds: string[]
  text: string
  unanswered?: boolean
}

type RefineQuestion = {
  id: string
  prompt: string
  candidates: { id: string; label: string }[]
}

type RefineBatch = {
  id: string
  status: "preparing" | "ready" | "failed" | "submitted"
  questions: RefineQuestion[]
  answers?: RefineAnswer[]
}

type RefineSession = {
  id: string
  originalPrompt: string
  status: "clarifying" | "research-started"
  prepState: "idle" | "preparing" | "failed"
  pendingBatchId: string | null
  currentBatchId: string | null
  batches: RefineBatch[]
  draftAnswers: RefineAnswer[]
  prepSearches: { deepSearchJobId: string; title: string; status: string; slug: string }[]
  research?: { deepSearchJobId: string; slug: string } | null
}

async function getSession(request: APIRequestContext, id: string): Promise<RefineSession> {
  const response = await request.get(`/api/refine-sessions/${id}`)
  expect(response.status()).toBe(200)
  return (await response.json() as { refineSession: RefineSession }).refineSession
}

const screenshotDirectory = fileURLToPath(new URL("../test-results/", import.meta.url))

async function capture(page: Page, name: string): Promise<void> {
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({
    path: fileURLToPath(new URL(`../test-results/${name}`, import.meta.url)),
    fullPage: true,
  })
}

test.describe("Refine", () => {
  test("condenses the complete saved clarification record before handing it to research", async ({ page, request }) => {
    test.setTimeout(60_000)
    const marker = "[E2E_REFINE_CONDENSE]"
    const requirement = "Explicit requirements: retain the budget cap £123 and removable-only constraint."
    const sourcePrefix = `Research practical renter-friendly energy interventions. ${marker} ${requirement} `
    const originalPrompt = `${sourcePrefix}${"Background on the apartment energy context. ".repeat(300)}`.slice(0, 10_000)
    expect(originalPrompt).toHaveLength(10_000)

    await page.goto("/refine")
    await page.getByLabel("What would you like to research?").fill(originalPrompt)
    const creation = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/refine-sessions",
    )
    await page.getByRole("button", { name: "Start refining" }).click()
    const created = await creation
    expect(created.status()).toBe(202)
    const { refineSession } = await created.json() as { refineSession: RefineSession }

    await expect.poll(async () => (await getSession(request, refineSession.id)).batches.at(-1)?.status, { timeout: 30_000 }).toBe("ready")
    const initial = await getSession(request, refineSession.id)
    expect(initial.originalPrompt.startsWith(sourcePrefix)).toBe(true)
    expect(initial.originalPrompt.length).toBeGreaterThan(9_900)
    const firstQuestion = page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })
    const supplementalAnswer = `[E2E_REFINE_CONDENSE_ANSWER] Keep landlord permission central. ${"Additional resident context. ".repeat(60)}`
    await firstQuestion.getByLabel("Add your own context").fill(supplementalAnswer)
    await expect.poll(async () => (await getSession(request, refineSession.id)).draftAnswers.find(({ questionId }) => questionId === initial.batches[0]?.questions[0]?.id)?.text, { timeout: 10_000 }).toBe(supplementalAnswer)
    await page.reload()
    await expect(page.getByText(marker, { exact: false })).toBeVisible()
    await expect(page.getByRole("group", { name: "Which renter constraint should the research prioritize?" }).getByLabel("Add your own context")).toHaveValue(supplementalAnswer)
    expect((await getSession(request, refineSession.id)).originalPrompt).toBe(initial.originalPrompt)

    const startRequest = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === `/api/refine-sessions/${refineSession.id}/research`,
    )
    await page.getByRole("button", { name: "Start research" }).click()
    const started = await startRequest
    expect([200, 202]).toContain(started.status())
    const startInput = started.request().postDataJSON() as { batchId: string; answers: RefineAnswer[] }
    expect(startInput.answers).toContainEqual(expect.objectContaining({ text: supplementalAnswer }))
    expect(startInput.answers).toContainEqual(expect.objectContaining({ selectedCandidateIds: [], text: "" }))

    const linked = await started.json() as { refineSession: RefineSession }
    expect(linked.refineSession.status).toBe("research-started")
    const slug = linked.refineSession.research?.slug
    expect(slug).toBeTruthy()
    await expect.poll(async () => {
      const response = await request.get(`/api/deep-search-jobs/${slug}`)
      if (!response.ok()) return null
      return ((await response.json()) as { deepSearchJob: { status: string } }).deepSearchJob.status
    }, { timeout: 20_000 }).toBe("completed")
    const researchResponse = await request.get(`/api/deep-search-jobs/${slug}`)
    const research = (await researchResponse.json() as { deepSearchJob: { researchRequest: string } }).deepSearchJob
    expect(research.researchRequest.length).toBeLessThanOrEqual(10_000)
    expect(research.researchRequest).toContain("budget cap £123 and removable-only constraint")
    expect(research.researchRequest).toContain("Keep landlord permission central.")
    expect(research.researchRequest).toContain("What outcome matters most? Answer: UNANSWERED.")

    const duplicate = await request.post(`/api/refine-sessions/${refineSession.id}/research`, {
      data: startInput,
      headers: { Origin: process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174" },
    })
    expect([200, 202]).toContain(duplicate.status())
    const duplicateSession = (await duplicate.json() as { refineSession: RefineSession }).refineSession
    expect(duplicateSession.research?.deepSearchJobId).toBe(linked.refineSession.research?.deepSearchJobId)
  })

  test("keeps submitted batches visible, restores drafts, and starts the existing research flow", async ({ page, request }) => {
    test.setTimeout(45_000)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/refine")
    await page.getByLabel("What would you like to research?").fill("Research practical renter-friendly energy interventions [E2E_REFINE_EVIDENCE_IDS]")

    const creation = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/refine-sessions",
    )
    await page.getByRole("button", { name: "Start refining" }).click()
    const created = await creation
    expect(created.status()).toBe(202)
    const { refineSession: initial } = await created.json() as { refineSession: RefineSession }
    await expect(page).toHaveURL(new RegExp(`/refine/${initial.id}$`))

    await expect.poll(async () => (await getSession(request, initial.id)).batches.at(-1)?.status, { timeout: 20_000 }).toBe("ready")
    const firstQuestion = page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })
    await expect(firstQuestion).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Automated research" })).toBeVisible()
    const prepSearchLink = page.getByRole("link", { name: "Saved Research Request" })
    await expect(prepSearchLink).toBeVisible()
    await page.goto("/deep-search?source=automated")
    const refineOrigin = page.getByRole("link", { name: /From Refine:/ }).first()
    await expect(refineOrigin).toHaveAttribute("href", `/refine/${initial.id}`)
    await refineOrigin.click()
    await expect(page).toHaveURL(new RegExp(`/refine/${initial.id}$`))
    await expect(firstQuestion).toBeVisible()

    await firstQuestion.getByLabel(/^Landlord permission(?: —|$)/).check()
    await firstQuestion.getByLabel(/^Upfront cost(?: —|$)/).check()
    await firstQuestion.getByLabel("Add your own context").fill("Landlord approval is the main barrier.")
    const secondQuestion = page.getByRole("group", { name: "What outcome matters most?" })
    await expect(secondQuestion).toBeVisible()
    // Leave the second question unanswered to exercise the explicit skip path.
    const submitted = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/refine-sessions/${initial.id}/batches`,
    )
    await page.getByRole("button", { name: "Ask more questions" }).click()
    expect([200, 202]).toContain((await submitted).status())

    const secondBatchQuestion = page.getByRole("group", { name: "What measurable result should the intervention target?" })
    await expect(secondBatchQuestion).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Landlord permission(?: —|$)/)).toBeVisible()
    await expect(page.getByText(/Upfront cost(?: —|$)/)).toBeVisible()
    await expect(page.getByText("Landlord approval is the main barrier.", { exact: true })).toBeVisible()
    await expect(page.getByText("Unanswered", { exact: true })).toBeVisible()
    const priorQuestionFieldset = page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })
    await expect(priorQuestionFieldset).toHaveCount(0)
    await capture(page, "refine-desktop-ready.png")

    const persistedAfterRoundOne = await getSession(request, initial.id)
    expect(persistedAfterRoundOne.batches).toHaveLength(2)
    const submittedBatch = persistedAfterRoundOne.batches[0]
    expect(submittedBatch.status).toBe("submitted")
    expect(submittedBatch.answers?.find(({ questionId }) => questionId === submittedBatch.questions[0]?.id)).toMatchObject({
      text: "Landlord approval is the main barrier.",
      unanswered: false,
    })
    expect(submittedBatch.answers?.find(({ questionId }) => questionId === submittedBatch.questions[1]?.id)).toMatchObject({
      selectedCandidateIds: [],
      text: "",
      unanswered: true,
    })

    await secondBatchQuestion.getByLabel("Lower bills").check()
    await secondBatchQuestion.getByLabel("Add your own context").fill("[E2E_REFINE_SECOND_BATCH] Prioritize outcomes tenants notice.")
    await expect.poll(async () => {
      const saved = await getSession(request, initial.id)
      return saved.draftAnswers.some(({ text }) => text.includes("Prioritize outcomes tenants notice."))
    }).toBe(true)
    await page.reload()
    const restoredSecondBatch = page.getByRole("group", { name: "What measurable result should the intervention target?" })
    await expect(restoredSecondBatch.getByLabel("Lower bills")).toBeChecked()
    await expect(restoredSecondBatch.getByLabel("Add your own context")).toHaveValue("[E2E_REFINE_SECOND_BATCH] Prioritize outcomes tenants notice.")

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/refine/${initial.id}`)
    await expect(page.getByRole("group", { name: "What measurable result should the intervention target?" })).toBeVisible()
    await capture(page, "refine-mobile-390.png")

    const startRequest = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/refine-sessions/${initial.id}/research`,
    )
    await page.getByRole("button", { name: "Start research" }).click()
    const started = await startRequest
    expect([200, 202]).toContain(started.status())
    const submittedResearchInput = started.request().postDataJSON() as { batchId: string; answers: RefineAnswer[] }

    const sessionAfterStart = await getSession(request, initial.id)
    expect(sessionAfterStart.status).toBe("research-started")
    expect(sessionAfterStart.research?.slug).toBeTruthy()
    expect(sessionAfterStart.batches).toHaveLength(2)
    await expect.poll(async () => {
      const response = await request.get(`/api/deep-search-jobs/${sessionAfterStart.research?.slug}`)
      if (!response.ok()) return null
      return ((await response.json()) as { deepSearchJob: { status: string } }).deepSearchJob.status
    }, { timeout: 20_000 }).toBe("completed")
    const finalResponse = await request.get(`/api/deep-search-jobs/${sessionAfterStart.research?.slug}`)
    expect(finalResponse.status()).toBe(200)
    const finalJob = (await finalResponse.json() as { deepSearchJob: { researchRequest: string } }).deepSearchJob
    expect(finalJob.researchRequest).toContain("Research practical renter-friendly energy interventions")
    expect(finalJob.researchRequest).toContain("Landlord approval is the main barrier.")
    expect(finalJob.researchRequest).toContain("Lower bills")
    expect(finalJob.researchRequest).toMatch(/unanswered/i)

    await page.goto("/deep-search")
    await expect(page.getByRole("tab", { name: "My Searches" })).toHaveAttribute("aria-selected", "true")
    await expect(page.locator(`a[href="/deep-search/${sessionAfterStart.research?.slug}"]`)).toBeVisible()

    const duplicateStart = await request.post(`/api/refine-sessions/${initial.id}/research`, {
      data: submittedResearchInput,
      headers: { Origin: process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174" },
    })
    expect([200, 202]).toContain(duplicateStart.status())
    const duplicateSession = (await duplicateStart.json() as { refineSession: RefineSession }).refineSession
    expect(duplicateSession.research?.deepSearchJobId).toBe(sessionAfterStart.research?.deepSearchJobId)

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/refine/${initial.id}`)
    await expect(page.getByText("Your Refine session is read-only.")).toBeVisible()
    await expect(page.getByRole("link", { name: "Open research" })).toHaveAttribute("href", `/deep-search/${sessionAfterStart.research?.slug}`)
    await expect(page.getByRole("button", { name: "Start research" })).toHaveCount(0)
  })

  test("preserves answered context after preparation failure and retries", async ({ page, request }) => {
    test.setTimeout(45_000)
    await page.goto("/refine")
    await page.getByLabel("What would you like to research?").fill("Research practical renter-friendly energy interventions")
    const creation = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/refine-sessions")
    await page.getByRole("button", { name: "Start refining" }).click()
    const created = await creation
    const { refineSession } = await created.json() as { refineSession: RefineSession }
    await expect(page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })).toBeVisible({ timeout: 20_000 })
    const firstQuestion = page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })
    await firstQuestion.getByLabel(/^Landlord permission(?: —|$)/).check()
    await firstQuestion.getByLabel("Add your own context").fill("[E2E_REFINE_PREP_FAIL_ONCE] Keep landlord permission central.")
    await page.getByRole("button", { name: "Ask more questions" }).click()

    await expect(page.getByText("Question preparation failed.", { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("button", { name: "Retry question preparation" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Start research" })).toBeEnabled()
    const failed = await getSession(request, refineSession.id)
    expect(failed.prepState).toBe("failed")
    expect(failed.batches[0]?.status).toBe("submitted")
    expect(failed.batches[0]?.answers?.[0]).toMatchObject({ text: "[E2E_REFINE_PREP_FAIL_ONCE] Keep landlord permission central." })

    await page.getByRole("button", { name: "Retry question preparation" }).click()
    await expect.poll(async () => {
      const snapshot = await getSession(request, refineSession.id)
      if (snapshot.prepState === "failed") console.log("Refine retry snapshot:", JSON.stringify(snapshot))
      return snapshot.prepState
    }, { timeout: 24_000 }).toBe("idle")
    await expect(page.getByRole("group", { name: "What measurable result should the intervention target?" })).toBeVisible({ timeout: 25_000 })
    const retried = await getSession(request, refineSession.id)
    expect(retried.batches[0]?.status).toBe("submitted")
    expect(retried.batches[0]?.answers?.[0]?.text).toContain("Keep landlord permission central.")
    expect(retried.batches.filter(({ status }) => status === "ready")).toHaveLength(1)
  })

  test("starts research during preparation and prevents a stale question batch", async ({ page, request }) => {
    test.setTimeout(45_000)
    await page.goto("/refine")
    await page.getByLabel("What would you like to research?").fill("[E2E_REFINE_CANCEL_PREP] Research practical renter-friendly energy interventions")
    const creation = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/refine-sessions")
    await page.getByRole("button", { name: "Start refining" }).click()
    const created = await creation
    const { refineSession } = await created.json() as { refineSession: RefineSession }
    await expect(page.getByText("Preparing questions…")).toBeVisible({ timeout: 10_000 })
    const startButton = page.getByRole("button", { name: "Start research" })
    await expect(startButton).toBeEnabled()

    const startRequest = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/refine-sessions/${refineSession.id}/research`)
    await startButton.click()
    const started = await startRequest
    expect([200, 202]).toContain(started.status())
    const researchInput = started.request().postDataJSON() as { batchId: string; answers: RefineAnswer[] }
    const committed = await started.json() as { refineSession: RefineSession }
    expect(committed.refineSession.status).toBe("research-started")

    const duplicate = await request.post(`/api/refine-sessions/${refineSession.id}/research`, {
      data: researchInput,
      headers: { Origin: process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174" },
    })
    expect([200, 202]).toContain(duplicate.status())
    const duplicateSnapshot = (await duplicate.json() as { refineSession: RefineSession }).refineSession
    expect(duplicateSnapshot.research?.deepSearchJobId).toBe(committed.refineSession.research?.deepSearchJobId)

    await expect.poll(async () => {
      const state = await getSession(request, refineSession.id)
      return state.prepSearches[0]?.status
    }, { timeout: 15_000 }).toBe("interrupted")
    const finalState = await getSession(request, refineSession.id)
    expect(finalState.status).toBe("research-started")
    expect(finalState.batches).toHaveLength(1)
    expect(finalState.batches[0]?.questions).toEqual([])
    await page.goto(`/refine/${refineSession.id}`)
    await expect(page.getByRole("link", { name: "Open research" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Start research" })).toHaveCount(0)
  })

  test("routes targeted controller research through the linked deep-search flow", async ({ page, request }) => {
    test.setTimeout(45_000)
    await page.goto("/refine")
    await page.getByLabel("What would you like to research?").fill("[E2E_REFINE_TARGETED_TOOL] Research renter adoption constraints")
    const creation = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/refine-sessions",
    )
    await page.getByRole("button", { name: "Start refining" }).click()
    const created = await creation
    const { refineSession } = await created.json() as { refineSession: RefineSession }

    await expect.poll(async () => {
      const snapshot = await getSession(request, refineSession.id)
      const batch = snapshot.batches.at(-1)
      if (batch?.status === "failed") console.log("Refine targeted controller failure:", JSON.stringify(snapshot))
      return batch?.status
    }, { timeout: 30_000 }).toBe("ready")
    await expect(page.getByRole("group", { name: "Which renter constraint should the research prioritize?" })).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => (await getSession(request, refineSession.id)).prepSearches.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
    const session = await getSession(request, refineSession.id)
    const targetedPrep = session.prepSearches.at(-1)
    expect(targetedPrep?.deepSearchJobId).toBeTruthy()
    const linkedJobResponse = await request.get(`/api/deep-search-jobs/${targetedPrep?.slug}`)
    expect(linkedJobResponse.status()).toBe(200)
    const linkedJob = (await linkedJobResponse.json() as { deepSearchJob: { researchRequest: string } }).deepSearchJob
    expect(linkedJob.researchRequest).toContain("E2E targeted search: exact renter deposit and landlord permission evidence")
    expect(linkedJob.researchRequest).toContain("Targeted research need:")

    await expect.poll(async () => {
      const response = await request.get(`/api/deep-search-jobs/${targetedPrep?.slug}`)
      if (!response.ok()) return null
      return ((await response.json()) as { deepSearchJob: { status: string } }).deepSearchJob.status
    }, { timeout: 20_000 }).toBe("completed")
  })
})
