import { expect, test } from "@playwright/test"
import type {
  DebateJobEvent,
  DebateTournamentSnapshot,
} from "../lib/debateJobs.ts"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const debatePrompt =
  "Design a practical product that helps small apartment buildings reduce energy use without installing new hardware, changing utility providers, or adding substantial work for residents or building managers."
const injectedFailureMessage = "Injected debate opening failure"

function parseEvents(body: string): DebateJobEvent[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DebateJobEvent)
}

// Provider, search, and page responses are deterministic, while the Hono
// routes, SQLite writes, orchestration, streams, snapshots, and browser UI are
// real. The API preload rejects every outbound host it does not explicitly
// mock, so successful completion also proves that no live provider was called.
test.describe("Debate tournament", () => {
  test("runs all 33 matches, streams progress, and survives reload", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)

    const unexpectedBrowserRequests: string[] = []
    const browserStreamRequests: string[] = []
    let createRequestCount = 0
    let eventRequestCount = 0
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url())
      if (url.protocol !== "http:" && url.protocol !== "https:") return
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        unexpectedBrowserRequests.push(url.href)
      }
      if (
        browserRequest.method() === "POST" &&
        url.pathname === "/api/debate-jobs"
      ) {
        createRequestCount += 1
      }
      if (
        browserRequest.method() === "GET" &&
        /^\/api\/streams\/[0-9a-f-]+$/i.test(url.pathname)
      ) {
        browserStreamRequests.push(url.pathname)
      }
      if (
        browserRequest.method() === "GET" &&
        /^\/api\/debate-jobs\/[^/]+\/events$/.test(url.pathname)
      ) {
        eventRequestCount += 1
      }
    })

    await page.goto("/debates")
    await expect(
      page.getByRole("heading", { name: "Debate ideas" }),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Open the idea generator instead" }),
    ).toHaveAttribute("href", "/ideas")

    const prompt = debatePrompt
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/debate-jobs",
    )
    const liveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/debate-jobs\/[^/]+\/events$/.test(
          new URL(response.url()).pathname,
        ),
    )

    await page.getByLabel("What should the ideas solve?").fill(prompt)
    await page.getByRole("button", { name: "Start tournament" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({ prompt })
    const { debateJobId } = (await created.json()) as { debateJobId: string }
    expect(debateJobId).toMatch(uuidPattern)
    expect(created.headers()["location"]).toBe(
      `/api/debate-jobs/${debateJobId}`,
    )
    await expect(page).toHaveURL(new RegExp(`/debates/${debateJobId}$`))
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()

    const live = await liveResponse
    expect(live.status()).toBe(200)
    expect(live.headers()["content-type"]).toContain("application/x-ndjson")
    await expect(page.getByText("Running automatically")).toBeVisible()
    await expect(page.getByText(/\d+\/33 matches/)).toBeVisible()
    await expect(page.getByText("Streaming", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const transcript = page.getByRole("log", { name: "Debate messages" })
    await expect(transcript).toContainText(
      "makes the stronger opening case",
      { timeout: 30_000 },
    )
    expect(await transcript.textContent()).not.toContain(
      "with no installation burden.",
    )
    expect(browserStreamRequests.length).toBeGreaterThan(0)

    const streamRequestCountBeforeReload = browserStreamRequests.length
    const debateUrl = page.url()
    await page.reload()
    await expect(page).toHaveURL(debateUrl)
    await expect(page.getByText("Running automatically")).toBeVisible()
    await expect(page.getByText("Streaming", { exact: true })).toBeVisible()
    await expect
      .poll(() => eventRequestCount)
      .toBeGreaterThan(1)
    await expect
      .poll(() => browserStreamRequests.length)
      .toBeGreaterThan(streamRequestCountBeforeReload)
    await expect(transcript).toContainText(
      /makes the stronger opening case|answers the opposing case/,
    )

    await expect(page.getByText("Tournament complete")).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText("33/33 matches", { exact: true })).toBeVisible()
    await expect(page.getByText("Winning idea", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Renter Energy Idea 1", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        "A concrete renter-friendly energy product concept 1, grounded in the combined mock research evidence.",
        { exact: true },
      ),
    ).toBeVisible()

    const terminalEventsResponse = await request.get(
      `/api/debate-jobs/${debateJobId}/events`,
    )
    expect(terminalEventsResponse.status()).toBe(200)
    const liveEvents = parseEvents(await terminalEventsResponse.text())
    expect(liveEvents.at(-1)).toEqual({ type: "done" })
    expect(liveEvents.some((event) => event.type === "updated")).toBe(true)
    expect(liveEvents.some((event) => event.type === "error")).toBe(false)

    const detail = await request.get(`/api/debate-jobs/${debateJobId}`)
    expect(detail.status()).toBe(200)
    const { debateJob } = (await detail.json()) as {
      debateJob: DebateTournamentSnapshot
    }
    expect(debateJob).toMatchObject({
      debateJobId,
      prompt,
      stage: "final",
      status: "completed",
      expectedMatchCount: 33,
      error: null,
    })
    expect(debateJob.ideaJobId).toMatch(uuidPattern)
    await expect(
      page.getByRole("link", { name: "View the underlying idea generation" }),
    ).toHaveAttribute("href", `/ideas/${debateJob.ideaJobId}`)
    expect(debateJob.standings).toHaveLength(12)
    expect(debateJob.rounds.filter((round) => round.stage === "swiss")).toHaveLength(
      5,
    )
    expect(
      debateJob.rounds.filter((round) => round.stage === "semifinal"),
    ).toHaveLength(1)
    expect(debateJob.rounds.filter((round) => round.stage === "final")).toHaveLength(
      1,
    )

    const matches = debateJob.rounds.flatMap((round) => round.matches)
    expect(matches).toHaveLength(33)
    for (const match of matches) {
      expect(match.status).toBe("completed")
      expect([match.firstIdea.ideaId, match.secondIdea.ideaId]).toContain(
        match.winnerIdeaId,
      )
      expect(match.messages).toHaveLength(5)
      expect(match.messages.map((message) => message.position)).toEqual([
        0, 1, 2, 3, 4,
      ])
      expect(match.messages.map((message) => message.speakerSlot)).toEqual([
        0, 1, 0, 1, 2,
      ])
      expect(match.messages.every((message) => message.text.length > 0)).toBe(
        true,
      )
      expect(match.messages[4]?.text).toContain("wins because")
    }

    const final = debateJob.rounds.find((round) => round.stage === "final")
      ?.matches[0]
    expect(final).toBeDefined()
    const winner = [final?.firstIdea, final?.secondIdea].find(
      (idea) => idea?.ideaId === final?.winnerIdeaId,
    )
    expect(winner?.title).toBe("Renter Energy Idea 1")

    const selectableMatch = page
      .getByRole("button", { name: /^Open .+ versus .+$/ })
      .first()
    const selectedLabel = await selectableMatch.getAttribute("aria-label")
    expect(selectedLabel).not.toBeNull()
    const selectedFirstIdea = /^Open (.+) versus /.exec(selectedLabel ?? "")?.[1]
    expect(selectedFirstIdea).toBeTruthy()
    await selectableMatch.click()
    await expect(transcript).toContainText(
      selectedFirstIdea ?? "missing idea title",
    )
    await expect(transcript).toContainText("Tournament judge")

    await page.goto("/debates")
    const historyLink = page.locator(`a[href="/debates/${debateJobId}"]`)
    await expect(historyLink).toContainText(prompt)
    await historyLink.click()
    await expect(page).toHaveURL(new RegExp(`/debates/${debateJobId}$`))
    await expect(page.getByText("Tournament complete")).toBeVisible()

    expect(createRequestCount).toBe(1)
    expect(browserStreamRequests.every((path) => uuidPattern.test(path.slice(-36)))).toBe(
      true,
    )
    expect(unexpectedBrowserRequests).toEqual([])
  })

  test("fails on one provider error without retrying or starting another round", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)

    let createRequestCount = 0
    page.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "POST" &&
        new URL(browserRequest.url()).pathname === "/api/debate-jobs"
      ) {
        createRequestCount += 1
      }
    })

    const failurePrompt = `${debatePrompt} [E2E_FAIL_FIRST_DEBATE_OPENING:${crypto.randomUUID()}]`
    await page.goto("/debates")
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/debate-jobs",
    )
    await page.getByLabel("What should the ideas solve?").fill(failurePrompt)
    await page.getByRole("button", { name: "Start tournament" }).click()

    const created = await createdResponse
    const { debateJobId } = (await created.json()) as { debateJobId: string }
    expect(created.status()).toBe(202)
    expect(debateJobId).toMatch(uuidPattern)
    await expect(page).toHaveURL(new RegExp(`/debates/${debateJobId}$`))
    await expect(page.getByText("Tournament failed")).toBeVisible({
      timeout: 60_000,
    })
    await expect(
      page.getByText(
        "The tournament stopped before it could finish. You can review the completed matches below or start a new tournament.",
        { exact: true },
      ),
    ).toBeVisible()
    await expect(
      page.getByText(injectedFailureMessage, { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Start a new tournament" }),
    ).toHaveAttribute("href", "/debates")
    await expect(page.getByText("Winning idea", { exact: true })).toHaveCount(0)

    const detail = await request.get(`/api/debate-jobs/${debateJobId}`)
    expect(detail.status()).toBe(200)
    const { debateJob } = (await detail.json()) as {
      debateJob: DebateTournamentSnapshot
    }
    expect(debateJob).toMatchObject({
      debateJobId,
      prompt: failurePrompt,
      stage: "swiss",
      status: "failed",
      error: injectedFailureMessage,
    })
    expect(debateJob.rounds).toHaveLength(1)
    expect(debateJob.rounds[0]).toMatchObject({
      stage: "swiss",
      stageRoundNumber: 1,
    })
    expect(debateJob.rounds[0]?.matches).toHaveLength(6)

    const completedMatches = debateJob.rounds[0]?.matches.filter(
      (match) => match.status === "completed",
    )
    const incompleteMatches = debateJob.rounds[0]?.matches.filter(
      (match) => match.status !== "completed",
    )
    expect(completedMatches).toHaveLength(5)
    expect(completedMatches?.every((match) => match.messages.length === 5)).toBe(
      true,
    )
    expect(incompleteMatches).toHaveLength(1)
    expect(incompleteMatches?.[0]?.winnerIdeaId).toBeNull()
    expect(incompleteMatches?.[0]?.messages.map(({ position }) => position)).toEqual([
      0, 1,
    ])

    const terminalEvents = await request.get(
      `/api/debate-jobs/${debateJobId}/events`,
    )
    expect(parseEvents(await terminalEvents.text())).toEqual([
      { type: "updated" },
      { type: "error", message: injectedFailureMessage },
      { type: "done" },
    ])
    expect(createRequestCount).toBe(1)
  })
})
