import { expect, test } from "./fixtures.ts"
import type {
  DebateJobEvent,
  DebateTournamentSnapshot,
} from "../lib/debateJobs.ts"
import { getPromptExcerpt } from "../lib/promptPresentation.ts"

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
    browser,
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
    await page.getByLabel("Make this debate public").check()
    await page.getByRole("button", { name: "Start a debate" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({
      prompt,
      isPublic: true,
      numberOfIdeas: 12,
    })
    const { debateJobId, slug } = (await created.json()) as {
      debateJobId: string
      slug: string
    }
    expect(debateJobId).toMatch(uuidPattern)
    expect(created.headers()["location"]).toBe(
      `/api/debate-jobs/${slug}`,
    )
    await expect(page).toHaveURL(new RegExp(`/debates/${slug}$`))
    await expect(
      page.getByRole("heading", { name: "Apartment Energy Product Ideas" }),
    ).toBeVisible()
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

    const debateUrl = page.url()
    const anonymousContext = await browser.newContext()
    const anonymousPage = await anonymousContext.newPage()
    await anonymousPage.goto(debateUrl)
    await expect(
      anonymousPage.getByRole("link", { name: "Start your own debate" }),
    ).toHaveAttribute("href", "/debates")
    await expect(
      anonymousPage.getByRole("heading", {
        name: "Apartment Energy Product Ideas",
      }),
    ).toBeVisible()
    await expect(anonymousPage.getByText("Running automatically")).toBeVisible()
    await expect(anonymousPage.getByText("Debug User")).toHaveCount(0)
    await expect(
      anonymousPage.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveCount(0)

    const publicIdeaLink = anonymousPage.getByRole("link", {
      name: "View the underlying idea generation",
    })
    await expect(publicIdeaLink).toHaveAttribute("href", `/ideas/${slug}`)
    await publicIdeaLink.click()
    await expect(anonymousPage).toHaveURL(new RegExp(`/ideas/${slug}$`))
    await expect(
      anonymousPage.getByRole("heading", {
        name: "Apartment Energy Product Ideas",
      }),
    ).toBeVisible()
    await expect(anonymousPage.getByText(prompt, { exact: true })).toBeVisible()
    await anonymousPage
      .getByRole("button", { name: /Deep research/ })
      .click()
    const publicResearchLink = anonymousPage
      .locator('a[href^="/deep-search/"]')
      .first()
    await expect(publicResearchLink).toHaveAttribute(
      "href",
      /^\/deep-search\/[a-z0-9-]+$/,
    )
    await expect(publicResearchLink).toHaveAttribute("target", "_blank")
    const publicResearchPagePromise = anonymousContext.waitForEvent("page")
    await publicResearchLink.click()
    const publicResearchPage = await publicResearchPagePromise
    await expect(publicResearchPage).toHaveURL(/\/deep-search\/[a-z0-9-]+$/)
    await expect(
      publicResearchPage.getByRole("heading", {
        name: "London Renter Energy Constraints",
      }),
    ).toBeVisible()
    await expect(
      publicResearchPage.getByRole("heading", { name: "Final answer" }),
    ).toBeVisible()

    const streamRequestCountBeforeReload = browserStreamRequests.length
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

    await expect(page.getByText("Debate complete")).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText("33/33 matches", { exact: true })).toBeVisible()
    await expect(page.getByText("Winning idea", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", {
        name: "Improved Renter Energy Idea 1",
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(
        "A concrete renter-friendly energy product concept 1, grounded in the combined mock research evidence. The improved version adds a specific validation plan and measurable adoption criteria.",
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

    const detail = await request.get(`/api/debate-jobs/${slug}`)
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
    ).toHaveAttribute("href", `/ideas/${debateJob.slug}`)
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
    expect(winner?.title).toBe("Improved Renter Energy Idea 1")

    const visibilityResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/debate-jobs/${debateJobId}`,
    )
    const publicSwitch = page.getByRole("switch", { name: "Public debate" })
    await publicSwitch.click()
    expect((await visibilityResponse).status()).toBe(200)
    await expect(publicSwitch).not.toBeChecked()
    await anonymousPage.goto(debateUrl)
    await expect(
      anonymousPage.getByRole("heading", { name: "Debate not found" }),
    ).toBeVisible()
    await anonymousContext.close()

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
    await expect(transcript).toContainText("Judge")

    await page.goto("/debates")
    const historyLink = page.locator(`a[href="/debates/${slug}"]`)
    await expect(historyLink).toContainText("Apartment Energy Product Ideas")
    await expect(historyLink).toContainText(getPromptExcerpt(prompt))
    await historyLink.click()
    await expect(page).toHaveURL(new RegExp(`/debates/${slug}$`))
    await expect(page.getByText("Debate complete")).toBeVisible()

    expect(createRequestCount).toBe(1)
    expect(browserStreamRequests.every((path) => uuidPattern.test(path.slice(-36)))).toBe(
      true,
    )
    expect(unexpectedBrowserRequests).toEqual([])
  })

  test("fails after one opening exhausts provider retries without starting another round", async ({
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

    const failurePrompt = `${debatePrompt} [E2E_FAIL_DEBATE_OPENING:${crypto.randomUUID()}]`
    await page.goto("/debates")
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/debate-jobs",
    )
    await page.getByLabel("What should the ideas solve?").fill(failurePrompt)
    await page.getByRole("button", { name: "Start a debate" }).click()

    const created = await createdResponse
    const { debateJobId, slug } = (await created.json()) as {
      debateJobId: string
      slug: string
    }
    expect(created.status()).toBe(202)
    expect(debateJobId).toMatch(uuidPattern)
    await expect(page).toHaveURL(new RegExp(`/debates/${slug}$`))
    await expect(page.getByText("Debate failed")).toBeVisible({
      timeout: 60_000,
    })
    await expect(
      page.getByText(
        "The debate stopped before it could finish. You can review the completed matches below or start a new debate.",
        { exact: true },
      ),
    ).toBeVisible()
    await expect(
      page.getByText(new RegExp(injectedFailureMessage)),
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Start a new debate" }),
    ).toHaveAttribute("href", "/debates")
    await expect(page.getByText("Winning idea", { exact: true })).toHaveCount(0)

    const detail = await request.get(`/api/debate-jobs/${slug}`)
    expect(detail.status()).toBe(200)
    const { debateJob } = (await detail.json()) as {
      debateJob: DebateTournamentSnapshot
    }
    expect(debateJob).toMatchObject({
      debateJobId,
      prompt: failurePrompt,
      stage: "swiss",
      status: "failed",
      error: expect.stringContaining(injectedFailureMessage),
    })
    expect(debateJob.error).not.toBeNull()
    expect(debateJob.error).toContain(`${injectedFailureMessage} (attempt 3)`)
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
      { type: "error", message: debateJob.error },
      { type: "done" },
    ])
    expect(createRequestCount).toBe(1)
  })
})
