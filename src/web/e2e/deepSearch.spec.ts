import { expect, test, type Response } from "@playwright/test"

type SearchResult = {
  title: string
  shortText: string
  link: string
}

type DeepSearchJobEvent =
  | { type: "query-stream"; streamId: string }
  | {
      type: "search-results"
      searches: Array<{ query: string; results: SearchResult[] }>
    }
  | { type: "selection-stream"; query: string; streamId: string }
  | { type: "selected-search-results"; query: string; selectedLinks: string[] }
  | { type: "page-summary-stream"; url: string; streamId: string }
  | {
      type: "page-summary-error"
      url: string
      stage: "extraction" | "summary"
      message: string
    }
  | { type: "error"; message: string }
  | { type: "done" }

type TextStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" }

function parseEvents(body: string): DeepSearchJobEvent[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DeepSearchJobEvent)
}

function parseTextEvents(body: string): TextStreamEvent[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TextStreamEvent)
}

// This test deliberately uses real DeepSeek, SearXNG, and page extraction.
// Network requests are observed for assertions but are never intercepted.
test.describe("Deep search", () => {
  test("streams and replays a real extracted-page summary", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
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
        new URL(response.url()).pathname === "/api/deep-search",
    )
    const liveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/deep-search\/[^/]+$/.test(new URL(response.url()).pathname),
    )
    const queryStreamResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/streams\/[^/]+$/.test(new URL(response.url()).pathname),
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

    const { id } = (await created.json()) as { id: string }
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers()["location"]).toBe(`/api/deep-search/${id}`)
    await expect(page.getByText(`Job: ${id}`)).toBeVisible()

    const live = await liveResponse
    expect(new URL(live.url()).pathname).toBe(`/api/deep-search/${id}`)
    expect(live.status()).toBe(200)
    expect(live.headers()["content-type"]).toContain("application/x-ndjson")

    const queryStream = await queryStreamResponse
    expect(queryStream.status()).toBe(200)
    expect(queryStream.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    const selectionStreamResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/streams\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.url() !== queryStream.url(),
    )
    const queryEvents = parseTextEvents(await queryStream.text())
    expect(queryEvents.at(-1)).toEqual({ type: "done" })
    expect(queryEvents.some((event) => event.type === "error")).toBe(false)

    const generatedQueries = queryEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(generatedQueries.trim()).not.toBe("")
    await expect(page.getByTestId("generated-queries")).toHaveText(
      generatedQueries,
    )

    const selectionStream = await selectionStreamResponse
    expect(selectionStream.status()).toBe(200)
    expect(selectionStream.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    const selectionEvents = parseTextEvents(await selectionStream.text())
    expect(selectionEvents.at(-1)).toEqual({ type: "done" })
    expect(selectionEvents.some((event) => event.type === "error")).toBe(false)

    const streamedSelection = selectionEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedSelection.trim()).not.toBe("")
    await expect(
      page.locator('[data-testid^="selection-stream-"]').first(),
    ).toHaveText(streamedSelection)

    const liveEvents = parseEvents(await live.text())
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
    expect(new URL(queryStream.url()).pathname).toBe(
      `/api/streams/${queryStreamEvent?.streamId}`,
    )

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
    expect(new URL(selectionStream.url()).pathname).toBe(
      `/api/streams/${selectionStreamEvent?.streamId}`,
    )

    const selectedResults = liveEvents.find(
      (event) => event.type === "selected-search-results",
    )
    expect(selectedResults).toBeDefined()
    expect(selectedResults?.selectedLinks.length).toBeGreaterThan(0)
    expect(selectedResults?.selectedLinks.length).toBeLessThanOrEqual(3)

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
    const summaryEvents = parseTextEvents(
      await observedSummaryResponse?.text() ?? "",
    )
    expect(summaryEvents.at(-1)).toEqual({ type: "done" })
    expect(summaryEvents.some((event) => event.type === "error")).toBe(false)
    const streamedPageSummary = summaryEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(streamedPageSummary.trim()).not.toBe("")

    const generatedQueriesAccordion = page.getByRole("button", {
      name: "Generated search queries",
    })
    const resultsAccordion = page.getByRole("button", {
      name: `Results for ${searchResults?.searches[0]?.query ?? ""}`,
    })
    await expect(generatedQueriesAccordion).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(resultsAccordion).toHaveAttribute("aria-expanded", "false")

    await generatedQueriesAccordion.click()
    await resultsAccordion.click()
    await expect(generatedQueriesAccordion).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    await expect(resultsAccordion).toHaveAttribute("aria-expanded", "true")
    await expect(
      page.locator('[data-testid^="selection-stream-"]').first(),
    ).toBeVisible()

    const summarizedResult = page.locator(
      `[data-selected="true"]:has(a[href="${firstPageSummary?.url ?? ""}"])`,
    )
    await expect(summarizedResult).toBeVisible()
    await expect(
      summarizedResult.getByTestId("page-summary-text"),
    ).toHaveText(streamedPageSummary)
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
    expect(highlightedLinks.sort()).toEqual(
      [...(selectedResults?.selectedLinks ?? [])].sort(),
    )

    await generatedQueriesAccordion.click()
    await resultsAccordion.click()
    await expect(generatedQueriesAccordion).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(resultsAccordion).toHaveAttribute("aria-expanded", "false")

    const replay = await request.get(`/api/deep-search/${id}`)
    expect(replay.status()).toBe(200)
    expect(replay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseEvents(await replay.text())).toEqual(liveEvents)

    const summaryReplay = await request.get(summaryPath)
    expect(summaryReplay.status()).toBe(200)
    expect(summaryReplay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseTextEvents(await summaryReplay.text())).toEqual(summaryEvents)
  })
})
