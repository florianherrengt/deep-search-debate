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
  test("runs all 23 matches, streams progress, and survives reload", async ({
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
      page.getByRole("link", { name: "Only generate options" }),
    ).toHaveCount(0)
    const formActionTops = await Promise.all(
      [
        page.getByRole("button", { name: "Advanced options" }),
        page.getByRole("button", { name: "Start a debate" }),
      ].map((control) =>
        control.evaluate((element) => element.getBoundingClientRect().top),
      ),
    )
    expect(formActionTops[0]).toBe(formActionTops[1])

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
    await expect(
      page.getByRole("switch", { name: /public/i }),
    ).toHaveCount(0)
    await page.getByRole("button", { name: "Start a debate" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({
      prompt,
      isPublic: false,
      numberOfIdeas: 8,
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
    await expect(page.getByText("Debate in progress")).toBeVisible()
    await expect(page.getByText(/\d+\/23 matches/)).toBeVisible()
    const runningHeaderControlHeights = await Promise.all(
      [
        page.locator(".MuiChip-root").filter({ hasText: "Debate in progress" }),
        page.locator(".MuiChip-root").filter({ hasText: "Private" }),
        page.getByRole("button", { name: "Stop workflow" }),
        page.getByRole("button", { name: "Share" }),
      ].map((control) =>
        control.evaluate((element) => element.getBoundingClientRect().height),
      ),
    )
    expect(runningHeaderControlHeights).toEqual([30, 30, 30, 30])

    const debateUrl = page.url()
    const liveMatchLink = page
      .getByRole("link", { name: /^Open .+ versus .+$/ })
      .filter({ has: page.getByText("Live", { exact: true }) })
      .first()
    await expect(liveMatchLink).toBeVisible({ timeout: 30_000 })
    const liveMatchLabel = await liveMatchLink.getAttribute("aria-label")
    expect(liveMatchLabel).not.toBeNull()
    const matchHeading = (liveMatchLabel ?? "")
      .replace(/^Open /, "")
      .replace(" versus ", " vs ")
    await liveMatchLink.click()
    await expect(page).toHaveURL(/\/debates\/[^/]+\/matches\/[^/]+$/)
    const matchUrl = page.url()
    await expect(
      page.getByRole("heading", { name: matchHeading, level: 1 }),
    ).toBeVisible()
    await expect(page.getByText("Streaming", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const transcript = page.getByRole("log", { name: "Debate messages" })
    await expect(transcript).toContainText(
      "makes the stronger opening case",
      { timeout: 30_000 },
    )
    expect(browserStreamRequests.length).toBeGreaterThan(0)

    await page.reload()
    await expect(page).toHaveURL(matchUrl)
    await expect(
      page.getByRole("heading", { name: matchHeading, level: 1 }),
    ).toBeVisible()
    await expect(page.getByText("Streaming", { exact: true })).toBeVisible()
    await expect
      .poll(() => eventRequestCount)
      .toBeGreaterThan(1)
    await expect(transcript).toContainText(
      /makes the stronger opening case|answers the opposing case/,
    )

    const nextMatchLink = page.getByRole("link", { name: /^Next:/ })
    await expect(nextMatchLink).toBeVisible()
    const nextMatchPath = await nextMatchLink.getAttribute("href")
    expect(nextMatchPath).toMatch(/^\/debates\/[^/]+\/matches\/[^/]+$/)
    await page.setViewportSize({ width: 667, height: 375 })
    expect(
      await transcript.evaluate((element) =>
        window.getComputedStyle(element).overflowY,
      ),
    ).toBe("visible")
    await page.setViewportSize({ width: 375, height: 667 })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await nextMatchLink.click()
    await expect(page).toHaveURL(new RegExp(`${nextMatchPath ?? "missing"}$`))
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(
      page.getByRole("link", { name: /^Previous:/ }),
    ).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(matchUrl)
    await page.getByRole("link", { name: "Back to debate" }).click()
    await expect(page).toHaveURL(debateUrl)

    const publishResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/debate-jobs/${debateJobId}`,
    )
    await page.getByRole("button", { name: "Share" }).click()
    await page.getByRole("button", { name: "Make public" }).click()
    expect((await publishResponse).status()).toBe(200)
    await expect(page.getByText("Public", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close" }).click()

    const anonymousContext = await browser.newContext()
    const anonymousPage = await anonymousContext.newPage()
    await anonymousPage.goto(matchUrl)
    await expect(
      anonymousPage.getByRole("button", { name: "Join the waiting list" }),
    ).toBeVisible()
    await expect(
      anonymousPage.getByRole("heading", { name: matchHeading, level: 1 }),
    ).toBeVisible()
    await expect(
      anonymousPage.getByRole("log", { name: "Debate messages" }),
    ).toBeVisible()
    await expect(
      anonymousPage.getByRole("button", { name: "Share" }),
    ).toHaveCount(0)
    await expect(anonymousPage.getByText("Debug User")).toHaveCount(0)
    await expect(
      anonymousPage.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveCount(0)

    await anonymousPage.goto(debateUrl)
    await expect(
      anonymousPage.getByRole("heading", {
        name: "Apartment Energy Product Ideas",
      }),
    ).toBeVisible()
    await expect(anonymousPage.getByText("Debate in progress")).toBeVisible()
    await expect(
      anonymousPage.getByRole("button", { name: "Share" }),
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
    await expect(
      anonymousPage.getByRole("heading", { name: "Initial deep research" }),
    ).toBeVisible()
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

    await page.goto(debateUrl)
    await expect(page.getByText("Debate complete")).toBeVisible({
      timeout: 60_000,
    })
    const headerControlHeights = await Promise.all(
      [
        page.locator(".MuiChip-root").filter({ hasText: "Debate complete" }),
        page.locator(".MuiChip-root").filter({ hasText: "Public" }),
        page.getByRole("button", { name: "Share" }),
      ].map((control) =>
        control.evaluate((element) => element.getBoundingClientRect().height),
      ),
    )
    expect(headerControlHeights).toEqual([30, 30, 30])
    await expect(page.getByText("23/23 matches", { exact: true })).toBeVisible()
    await expect(page.getByText("Winning idea", { exact: true })).toBeVisible()
    await expect(page.getByText("Why it won", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Decisive strengths" }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Closest alternative" }),
    ).toBeVisible()
    await expect(
      page
        .getByRole("region", { name: "Closest alternative" })
        .getByText(/^Improved Renter Energy Idea \d+$/),
    ).toBeVisible()
    await expect(page.getByText(/wins because/)).toBeVisible()
    const winnerIdeaHeading = page.getByRole("heading", {
      name: "Improved Renter Energy Idea 1",
      exact: true,
    })
    await expect(winnerIdeaHeading).toBeVisible()
    await expect(winnerIdeaHeading.getByRole("link")).toHaveAttribute(
      "href",
      new RegExp(`^/ideas/${slug}/[0-9a-f-]+#improved-idea$`),
    )
    await expect(winnerIdeaHeading.getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    )
    await expect(
      page.getByRole("heading", { name: "Pros and cons" }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Pros", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Cons", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        "A concrete renter-friendly energy product concept 1, grounded in the combined mock research evidence. The improved version adds a specific validation plan and measurable adoption criteria.",
        { exact: true },
      ),
    ).toBeVisible()

    const debateFeedbackResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/debate-jobs/${debateJobId}/feedback`,
    )
    await page.getByRole("button", { name: "Thumbs up" }).click()
    expect((await debateFeedbackResponse).status()).toBe(200)
    await expect(page.getByRole("button", { name: "Thumbs up" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.reload()
    await expect(page.getByText("Debate complete")).toBeVisible()
    await expect(page.getByRole("button", { name: "Thumbs up" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    const ideaUrl = `/ideas/${slug}`
    await page.goto(ideaUrl)
    const ideaFeedbackResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /^\/api\/idea-jobs\/[^/]+\/feedback$/.test(
          new URL(response.url()).pathname,
        ),
    )
    await page.getByRole("button", { name: "Thumbs down" }).click()
    expect((await ideaFeedbackResponse).status()).toBe(200)
    const writtenFeedbackDialog = page.getByRole("dialog", {
      name: "What could be improved?",
    })
    await expect(writtenFeedbackDialog).toBeVisible()
    await writtenFeedbackDialog
      .getByRole("button", { name: "Not now" })
      .click()
    await page.reload()
    await expect(page.getByRole("button", { name: "Thumbs down" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    const ownerResearchPath = await page
      .locator('a[href^="/deep-search/"]')
      .first()
      .getAttribute("href")
    expect(ownerResearchPath).toMatch(/^\/deep-search\/[a-z0-9-]+$/)
    await page.goto(ownerResearchPath ?? "/deep-search/missing")
    const researchFeedbackResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /^\/api\/deep-search-jobs\/[^/]+\/feedback$/.test(
          new URL(response.url()).pathname,
        ),
    )
    await page.getByRole("button", { name: "Thumbs up" }).click()
    expect((await researchFeedbackResponse).status()).toBe(200)
    await page.reload()
    await expect(page.getByRole("button", { name: "Thumbs up" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    await anonymousPage.goto(debateUrl)
    await expect(anonymousPage.getByText("Debate complete")).toBeVisible()
    await expect(
      anonymousPage.getByRole("button", { name: /Thumbs (up|down)/ }),
    ).toHaveCount(0)
    await anonymousPage.goto(ideaUrl)
    await expect(
      anonymousPage.getByRole("button", { name: /Thumbs (up|down)/ }),
    ).toHaveCount(0)
    await anonymousPage.goto(ownerResearchPath ?? "/deep-search/missing")
    await expect(
      anonymousPage.getByRole("button", { name: /Thumbs (up|down)/ }),
    ).toHaveCount(0)

    await page.goto(debateUrl)

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
      expectedMatchCount: 23,
      error: null,
    })
    expect(debateJob.ideaJobId).toMatch(uuidPattern)
    await expect(
      page.getByRole("link", { name: "View the underlying idea generation" }),
    ).toHaveAttribute("href", `/ideas/${debateJob.slug}`)
    expect(debateJob.standings).toHaveLength(8)
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
    expect(matches).toHaveLength(23)
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
    await page.getByRole("button", { name: "Share" }).click()
    await page.getByRole("button", { name: "Make private" }).click()
    expect((await visibilityResponse).status()).toBe(200)
    await expect(page.getByText("Private", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close" }).click()
    await anonymousPage.goto(debateUrl)
    await expect(
      anonymousPage.getByRole("heading", { name: "Debate not found" }),
    ).toBeVisible()
    await anonymousContext.close()

    const selectableMatch = page
      .getByRole("link", { name: /^Open .+ versus .+$/ })
      .first()
    const selectedLabel = await selectableMatch.getAttribute("aria-label")
    expect(selectedLabel).not.toBeNull()
    const selectedFirstIdea = /^Open (.+) versus /.exec(selectedLabel ?? "")?.[1]
    expect(selectedFirstIdea).toBeTruthy()
    await selectableMatch.click()
    await expect(page).toHaveURL(/\/debates\/[^/]+\/matches\/[^/]+$/)
    await expect(transcript).toContainText(
      selectedFirstIdea ?? "missing idea title",
    )
    await expect(transcript).toContainText("Judge")
    await expect(
      page.getByRole("link", { name: "Back to debate" }),
    ).toHaveAttribute("href", `/debates/${slug}`)

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

  test("stops an active tournament without starting another round", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)

    const prompt = `${debatePrompt} [E2E_STOP_DEBATE]`
    await page.goto("/debates")
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/debate-jobs",
    )
    await page.getByLabel("What should the ideas solve?").fill(prompt)
    await page.getByRole("button", { name: "Start a debate" }).click()

    const created = await createdResponse
    const { debateJobId, slug } = (await created.json()) as {
      debateJobId: string
      slug: string
    }
    expect(created.status()).toBe(202)
    const liveMatch = page
      .getByRole("link", { name: /^Open .+ versus .+$/ })
      .filter({ has: page.getByText("Live", { exact: true }) })
      .first()
    await expect(liveMatch).toBeVisible({ timeout: 60_000 })

    const cancelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/debate-jobs/${debateJobId}/cancel`,
    )
    await page.getByRole("button", { name: "Stop workflow" }).click()
    const stopDialog = page.getByRole("dialog", {
      name: "Stop this workflow?",
    })
    await stopDialog.getByRole("button", { name: "Stop workflow" }).click()
    expect((await cancelResponse).status()).toBe(202)
    await expect(page.getByRole("button", { name: "Stopping…" })).toBeDisabled()
    await expect(page.getByText("Stopped").first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByText(
        "You stopped this debate. Completed matches and messages are kept.",
      ),
    ).toBeVisible()

    const detail = await request.get(`/api/debate-jobs/${slug}`)
    const { debateJob } = (await detail.json()) as {
      debateJob: DebateTournamentSnapshot
    }
    expect(debateJob).toMatchObject({
      debateJobId,
      stage: "swiss",
      status: "interrupted",
      stopRequested: true,
      canStop: false,
      error: "Workflow stopped by user",
    })
    expect(debateJob.rounds).toHaveLength(1)
    expect(debateJob.rounds[0]?.matches).toHaveLength(4)
    expect(
      debateJob.rounds[0]?.matches.some((match) => match.messages.length > 0),
    ).toBe(true)

    const ideaDetail = await request.get(`/api/idea-jobs/${slug}`)
    expect(ideaDetail.status()).toBe(200)
    const ideaPayload = (await ideaDetail.json()) as {
      ideaJob: {
        status: string
        stopRequested: boolean
        canStop: boolean
      }
    }
    expect(ideaPayload.ideaJob).toMatchObject({
      status: "completed",
      stopRequested: false,
      canStop: false,
    })
    const terminalEvents = await request.get(
      `/api/debate-jobs/${debateJobId}/events`,
    )
    expect(parseEvents(await terminalEvents.text())).toEqual([
      { type: "updated" },
      { type: "done" },
    ])

    await page.reload()
    await expect(page.getByText("Stopped").first()).toBeVisible()
    await expect(page.getByText(/\d+\/23 matches/)).toBeVisible()
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
    await expect(page.getByText("Debate failed").first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(
      page.getByText(
        "The debate stopped before it could finish. Review any completed matches, or start a new debate.",
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
    expect(debateJob.rounds[0]?.matches).toHaveLength(4)

    const completedMatches = debateJob.rounds[0]?.matches.filter(
      (match) => match.status === "completed",
    )
    const incompleteMatches = debateJob.rounds[0]?.matches.filter(
      (match) => match.status !== "completed",
    )
    expect(completedMatches).toHaveLength(3)
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
