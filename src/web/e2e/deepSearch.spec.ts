import { expect, test, type Response } from "@playwright/test"
import type { DeepSearchJobEvent } from "../lib/deepSearchJobs.ts"
import type { TextStreamEvent } from "../lib/textStreams.ts"

function parseEvents<Event>(body: string): Event[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Event)
}

// External HTTP responses are deterministic; the API, persistence, streaming,
// extraction pipeline, and browser behavior remain real.
test.describe("Deep search", () => {
  test("persists, reopens, and replays a mixed-result final answer", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await page.goto("/deep-search")

    const observedStreamResponses = new Map<string, Response>()
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname
      if (
        response.request().method() === "GET" &&
        /^\/api\/streams\/[^/]+$/.test(pathname)
      ) {
        observedStreamResponses.set(pathname, response)
      }
    })

    const researchRequest =
      "Find the official MDN documentation explaining JavaScript arrays. Generate only one search query, and make that query: !mdn JavaScript Array."
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/deep-search-jobs",
    )
    const liveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/deep-search-jobs\/[^/]+\/events$/.test(
          new URL(response.url()).pathname,
        ),
    )
    await page.getByLabel("Research request").fill(researchRequest)
    await page.getByRole("button", { name: "Start deep search" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({
      researchRequest,
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    const { deepSearchJobId } = (await created.json()) as {
      deepSearchJobId: string
    }
    expect(deepSearchJobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers()["location"]).toBe(
      `/api/deep-search-jobs/${deepSearchJobId}`,
    )
    await expect(page).toHaveURL(
      new RegExp(`/deep-search/${deepSearchJobId}$`),
    )
    await expect(page.getByText(`Job: ${deepSearchJobId}`)).toHaveCount(0)
    await expect(page.getByLabel("Research request")).toHaveCount(0)
    await expect(page.getByText(researchRequest)).toBeVisible()

    const live = await liveResponse
    expect(new URL(live.url()).pathname).toBe(
      `/api/deep-search-jobs/${deepSearchJobId}/events`,
    )
    expect(live.status()).toBe(200)
    expect(live.headers()["content-type"]).toContain("application/x-ndjson")

    const liveEvents = parseEvents<DeepSearchJobEvent>(await live.text())
    expect(liveEvents.at(-1)).toEqual({ type: "done" })
    const jobError = liveEvents.find((event) => event.type === "error")
    expect(
      jobError,
      jobError ? `Deep search job failed: ${jobError.message}` : undefined,
    ).toBeUndefined()

    const queryStreamEvent = liveEvents.find(
      (event) => event.type === "query-stream",
    )
    expect(queryStreamEvent).toBeDefined()
    const queryStream = await request.get(
      `/api/streams/${queryStreamEvent?.streamId ?? ""}`,
    )
    expect(queryStream.status()).toBe(200)
    expect(queryStream.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    const queryEvents = parseEvents<TextStreamEvent>(await queryStream.text())
    expect(queryEvents.at(-1)).toEqual({ type: "done" })
    expect(queryEvents.some((event) => event.type === "error")).toBe(false)

    const searchResults = liveEvents.find(
      (event) => event.type === "search-results",
    )
    expect(searchResults).toBeDefined()
    expect(searchResults?.searches.length).toBeGreaterThan(0)
    expect(searchResults?.searches.length).toBeLessThanOrEqual(3)
    expect(
      searchResults?.searches.some((search) => search.results.length > 0),
    ).toBe(true)

    const selectionStreamEvent = liveEvents.find(
      (event) => event.type === "selection-stream",
    )
    expect(selectionStreamEvent).toBeDefined()
    const selectionStream = await request.get(
      `/api/streams/${selectionStreamEvent?.streamId ?? ""}`,
    )
    expect(selectionStream.status()).toBe(200)
    expect(selectionStream.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    const selectionEvents = parseEvents<TextStreamEvent>(
      await selectionStream.text(),
    )
    expect(selectionEvents.at(-1)).toEqual({ type: "done" })
    expect(selectionEvents.some((event) => event.type === "error")).toBe(false)
    const streamedSelection = selectionEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedSelection.trim()).not.toBe("")

    const selectedResults = liveEvents.find(
      (event) => event.type === "selected-search-results",
    )
    expect(selectedResults).toBeDefined()
    expect(selectedResults?.selectedLinks.length).toBeGreaterThan(0)
    expect(selectedResults?.selectedLinks.length).toBeLessThanOrEqual(3)

    const summarizedSearch = searchResults?.searches.find(
      (search) => search.query === selectedResults?.query,
    )
    expect(summarizedSearch).toBeDefined()
    expect(summarizedSearch?.results.length).toBeGreaterThan(
      selectedResults?.selectedLinks.length ?? 0,
    )

    const pageSummaryStreams = liveEvents.filter(
      (
        event,
      ): event is Extract<
        DeepSearchJobEvent,
        { type: "page-summary-stream" }
      > => event.type === "page-summary-stream",
    )
    const pageSummaryErrors = liveEvents.filter(
      (
        event,
      ): event is Extract<
        DeepSearchJobEvent,
        { type: "page-summary-error" }
      > => event.type === "page-summary-error",
    )
    expect(
      pageSummaryStreams.length,
      `Expected at least one extracted page summary; failures: ${JSON.stringify(pageSummaryErrors)}`,
    ).toBeGreaterThan(0)

    const coveredSummaryUrls = new Set([
      ...pageSummaryStreams.map((event) => event.url),
      ...pageSummaryErrors.map((event) => event.url),
    ])
    for (const url of selectedResults?.selectedLinks ?? []) {
      expect(coveredSummaryUrls).toContain(url)
    }

    const firstPageSummary = pageSummaryStreams[0]
    expect(firstPageSummary).toBeDefined()
    const summaryPath = `/api/streams/${firstPageSummary?.streamId ?? ""}`
    await expect
      .poll(() => observedStreamResponses.has(summaryPath))
      .toBe(true)
    const observedSummaryResponse = observedStreamResponses.get(summaryPath)
    const summaryEvents = parseEvents<TextStreamEvent>(
      await observedSummaryResponse?.text() ?? "",
    )
    expect(summaryEvents.at(-1)).toEqual({ type: "done" })
    expect(summaryEvents.some((event) => event.type === "error")).toBe(false)
    const streamedPageSummary = summaryEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedPageSummary.trim()).not.toBe("")

    const querySummaryStreams = liveEvents.filter(
      (
        event,
      ): event is Extract<
        DeepSearchJobEvent,
        { type: "query-summary-stream" }
      > => event.type === "query-summary-stream",
    )
    expect(querySummaryStreams).toHaveLength(
      searchResults?.searches.length ?? 0,
    )
    const firstQuerySummary = querySummaryStreams[0]
    expect(firstQuerySummary).toBeDefined()
    expect(firstQuerySummary?.query).toBe(summarizedSearch?.query)
    const querySummaryPath = `/api/streams/${firstQuerySummary?.streamId ?? ""}`
    await expect
      .poll(() => observedStreamResponses.has(querySummaryPath))
      .toBe(true)
    const observedQuerySummaryResponse =
      observedStreamResponses.get(querySummaryPath)
    const querySummaryEvents = parseEvents<TextStreamEvent>(
      (await observedQuerySummaryResponse?.text()) ?? "",
    )
    expect(querySummaryEvents.at(-1)).toEqual({ type: "done" })
    expect(querySummaryEvents.some((event) => event.type === "error")).toBe(
      false,
    )
    const streamedQuerySummary = querySummaryEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedQuerySummary.trim()).not.toBe("")

    const finalAnswerStream = liveEvents.find(
      (event) => event.type === "final-answer-stream",
    )
    expect(finalAnswerStream).toBeDefined()
    const finalAnswerPath =
      `/api/streams/${finalAnswerStream?.streamId ?? ""}`
    await expect
      .poll(() => observedStreamResponses.has(finalAnswerPath))
      .toBe(true)
    const observedFinalAnswerResponse =
      observedStreamResponses.get(finalAnswerPath)
    const finalAnswerEvents = parseEvents<TextStreamEvent>(
      (await observedFinalAnswerResponse?.text()) ?? "",
    )
    expect(finalAnswerEvents.at(-1)).toEqual({ type: "done" })
    expect(finalAnswerEvents.some((event) => event.type === "error")).toBe(
      false,
    )
    const streamedFinalAnswer = finalAnswerEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedFinalAnswer.trim()).not.toBe("")

    const reasoningSections = [
      {
        events: queryEvents,
        section: page
          .getByRole("heading", { name: "Generated search queries" })
          .locator(".."),
      },
      {
        events: finalAnswerEvents,
        section: page
          .getByRole("heading", { name: "Final answer" })
          .locator(".."),
      },
      {
        events: selectionEvents,
        section: page
          .getByRole("heading", { name: "Source selection" })
          .locator(".."),
      },
      {
        events: querySummaryEvents,
        section: page
          .locator('[data-query-summary-status="completed"]')
          .first(),
      },
    ]
      .map(({ events, section }) => ({
        reasoning: events
          .filter((event) => event.type === "reasoning")
          .map((event) => event.text)
          .join(""),
        section,
      }))
      .filter(({ reasoning }) => reasoning)
    for (const { reasoning, section } of reasoningSections) {
      await expect(page.getByText(reasoning, { exact: true })).toBeHidden()
      await section.getByRole("button", { name: "Show reasoning" }).click()
      await expect(page.getByText(reasoning, { exact: true })).toBeVisible()
    }

    await expect(
      page.getByRole("heading", { name: "Research results" }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Final answer" }),
    ).toBeVisible()
    await expect(page.getByTestId("final-answer")).toHaveText(
      streamedFinalAnswer,
    )
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await expect(
      page.getByRole("heading", {
        name: searchResults?.searches[0]?.query ?? "",
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText("What this search found").first()).toBeVisible()
    await expect(
      page.getByTestId(`query-summary-${firstQuerySummary?.query ?? ""}`),
    ).toHaveText(streamedQuerySummary)
    await expect(
      page.locator('[data-query-summary-status="completed"]').first(),
    ).toBeVisible()
    await expect(
      page.getByTestId(`selection-${selectionStreamEvent?.query ?? ""}`),
    ).toHaveText(streamedSelection)

    const sourceResultsAccordion = page
      .getByRole("button", {
        name: `Show source results for ${searchResults?.searches[0]?.query ?? ""}`,
      })
      .first()
    await expect(sourceResultsAccordion).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await sourceResultsAccordion.click()
    await expect(sourceResultsAccordion).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    const summarizedResult = page.locator(
      `[data-selected="true"]:has(a[href="${firstPageSummary?.url ?? ""}"])`,
    )
    await expect(summarizedResult).toBeVisible()
    await expect(
      summarizedResult.getByTestId("page-summary-text"),
    ).toHaveText(streamedPageSummary)
    const pageReasoning = summaryEvents
      .filter((event) => event.type === "reasoning")
      .map((event) => event.text)
      .join("")
    expect(pageReasoning).not.toBe("")
    await expect(
      summarizedResult.getByText(pageReasoning, { exact: true }),
    ).toBeHidden()
    await summarizedResult
      .getByRole("button", { name: "Show reasoning" })
      .click()
    await expect(
      summarizedResult.getByText(pageReasoning, { exact: true }),
    ).toBeVisible()
    await expect(
      summarizedResult.locator('[data-summary-status="completed"]'),
    ).toBeVisible()

    const firstRenderedResult = page.locator('section a[target="_blank"]').first()
    await expect(firstRenderedResult).toBeVisible()
    await expect(firstRenderedResult).not.toHaveText("")
    await expect(firstRenderedResult).toHaveAttribute("href", /^https?:\/\//)

    const selectedResultLinks = page.locator('[data-selected="true"] a')
    await expect(selectedResultLinks.first()).toBeVisible()
    const highlightedLinks = await selectedResultLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    )
    expect(highlightedLinks.toSorted()).toEqual(
      (selectedResults?.selectedLinks ?? []).toSorted(),
    )

    await sourceResultsAccordion.click()
    await expect(sourceResultsAccordion).toHaveAttribute(
      "aria-expanded",
      "false",
    )

    const replay = await request.get(
      `/api/deep-search-jobs/${deepSearchJobId}/events`,
    )
    expect(replay.status()).toBe(200)
    expect(replay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseEvents<DeepSearchJobEvent>(await replay.text())).toEqual(
      liveEvents,
    )

    const summaryReplay = await request.get(summaryPath)
    expect(summaryReplay.status()).toBe(200)
    expect(summaryReplay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseEvents<TextStreamEvent>(await summaryReplay.text())).toEqual(
      summaryEvents,
    )

    const querySummaryReplay = await request.get(querySummaryPath)
    expect(querySummaryReplay.status()).toBe(200)
    expect(querySummaryReplay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseEvents<TextStreamEvent>(await querySummaryReplay.text())).toEqual(
      querySummaryEvents,
    )

    const detail = await request.get(
      `/api/deep-search-jobs/${deepSearchJobId}`,
    )
    expect(detail.status()).toBe(200)
    const detailBody = (await detail.json()) as {
      deepSearchJob: {
        deepSearchJobId: string
        researchRequest: string
        status: string
      }
    }
    expect(detailBody.deepSearchJob).toMatchObject({
      deepSearchJobId,
      researchRequest,
      status: "completed",
    })

    await page.reload()
    await expect(
      page.getByRole("heading", { name: "Research results" }),
    ).toBeVisible()
    await page.goto("/deep-search")
    await expect(page.getByRole("heading", { name: "Previous searches" })).toBeVisible()
    const historyLink = page.locator(
      `a[href="/deep-search/${deepSearchJobId}"]`,
    )
    await expect(historyLink).toBeVisible()
    await expect(historyLink).toContainText(researchRequest)
  })
})
