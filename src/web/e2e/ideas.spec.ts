import { expect, test, type APIRequestContext } from "@playwright/test"
import type { DeepSearchJobEvent } from "../lib/deepSearchJobs.ts"
import type { IdeaJobEvent } from "../lib/ideaJobs.ts"
import type { TextStreamEvent } from "../lib/textStreams.ts"

function parseEvents<Event>(body: string): Event[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Event)
}

async function readTextStream(
  request: APIRequestContext,
  streamId: string,
): Promise<{ events: TextStreamEvent[]; text: string }> {
  const response = await request.get(`/api/streams/${streamId}`)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/x-ndjson")

  const events = parseEvents<TextStreamEvent>(await response.text())
  expect(events.at(-1)).toEqual({ type: "done" })
  expect(events.some((event) => event.type === "error")).toBe(false)
  return {
    events,
    text: events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join(""),
  }
}

// External HTTP responses are deterministic; the API, persistence, streaming,
// extraction pipeline, and browser behavior remain real.
test.describe("Ideas", () => {
  test("runs, persists, and replays the complete researched-idea pipeline", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await page.goto("/ideas")

    const prompt =
      "Generate practical product ideas to help London renters reduce household energy use in 2026."
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/idea-jobs",
    )
    const liveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/idea-jobs\/[^/]+\/events$/.test(
          new URL(response.url()).pathname,
        ),
    )

    await page.getByLabel("What should we generate ideas for?").fill(prompt)
    await page.getByRole("button", { name: "Generate 12 ideas" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({
      prompt,
      numberOfIdeas: 12,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    const { ideaJobId } = (await created.json()) as { ideaJobId: string }
    expect(ideaJobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers()["location"]).toBe(`/api/idea-jobs/${ideaJobId}`)
    await expect(page).toHaveURL(new RegExp(`/ideas/${ideaJobId}$`))
    await expect(page.getByText(prompt, { exact: true })).toBeVisible()

    const live = await liveResponse
    expect(live.status()).toBe(200)
    expect(live.headers()["content-type"]).toContain("application/x-ndjson")
    const liveEvents = parseEvents<IdeaJobEvent>(await live.text())
    expect(liveEvents.at(-1)).toEqual({ type: "done" })
    const jobError = liveEvents.find((event) => event.type === "error")
    expect(
      jobError,
      jobError ? `Idea job failed: ${jobError.message}` : undefined,
    ).toBeUndefined()

    const planning = liveEvents.find(
      (event) => event.type === "research-prompt-stream",
    )
    const research = liveEvents.filter(
      (
        event,
      ): event is Extract<IdeaJobEvent, { type: "deep-search-started" }> =>
        event.type === "deep-search-started",
    )
    const summary = liveEvents.find(
      (event) => event.type === "research-summary-stream",
    )
    const ideaGeneration = liveEvents.find(
      (event) => event.type === "idea-generation-stream",
    )
    const ideas = liveEvents.filter(
      (event): event is Extract<IdeaJobEvent, { type: "idea" }> =>
        event.type === "idea",
    )

    expect(planning).toBeDefined()
    expect(research).toHaveLength(2)
    expect(new Set(research.map((item) => item.deepSearchJobId)).size).toBe(2)
    expect(new Set(research.map((item) => item.researchRequest)).size).toBe(2)
    expect(summary).toBeDefined()
    expect(ideaGeneration).toBeDefined()
    expect(ideas).toHaveLength(12)
    expect(
      Math.max(...research.map((item) => liveEvents.indexOf(item))),
    ).toBeLessThan(liveEvents.indexOf(summary!))

    const planningStream = await readTextStream(
      request,
      planning?.streamId ?? "",
    )
    const summaryStream = await readTextStream(request, summary?.streamId ?? "")
    const ideaStream = await readTextStream(
      request,
      ideaGeneration?.streamId ?? "",
    )
    expect(planningStream.text.trim()).not.toBe("")
    expect(summaryStream.text).toContain("insulation, heating-control")
    expect(summaryStream.text).toContain("Removable controls")
    expect(ideaStream.text.trim()).not.toBe("")

    const structuredIdeas = JSON.parse(ideaStream.text) as {
      elements: Array<{ title: string; description: string }>
    }
    expect(structuredIdeas.elements).toEqual(
      ideas.map(({ title, description }) => ({ title, description })),
    )

    for (const child of research) {
      const detail = await request.get(
        `/api/deep-search-jobs/${child.deepSearchJobId}`,
      )
      expect(detail.status()).toBe(200)
      expect(await detail.json()).toMatchObject({
        deepSearchJob: {
          deepSearchJobId: child.deepSearchJobId,
          ideaJobId,
          researchRequest: child.researchRequest,
          status: "completed",
        },
      })

      const childReplay = await request.get(
        `/api/deep-search-jobs/${child.deepSearchJobId}/events`,
      )
      const childEvents = parseEvents<DeepSearchJobEvent>(
        await childReplay.text(),
      )
      expect(childEvents.at(-1)).toEqual({ type: "done" })
      expect(childEvents.some((event) => event.type === "error")).toBe(false)
      const finalAnswer = childEvents.find(
        (event) => event.type === "final-answer-stream",
      )
      expect(finalAnswer).toBeDefined()
      const childFinalStream = await readTextStream(
        request,
        finalAnswer?.streamId ?? "",
      )
      expect(childFinalStream.text.trim()).not.toBe("")
    }

    const ideaStage = page.getByRole("button", { name: /Generate ideas/ })
    await expect(ideaStage).toContainText("Complete")
    await expect(ideaStage).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByText("Raw structured output")).toHaveCount(0)
    for (const idea of ideas) {
      await expect(
        page.getByRole("heading", { name: idea.title, exact: true }).first(),
      ).toBeVisible()
      await expect(
        page.getByText(idea.description, { exact: true }).first(),
      ).toBeVisible()
    }

    const summaryStage = page.getByRole("button", {
      name: /Summarise the research/,
    })
    await summaryStage.click()
    await expect(page.getByTestId("idea-research-summary")).toHaveText(
      summaryStream.text,
    )

    const researchStage = page.getByRole("button", { name: /Deep research/ })
    await researchStage.click()
    const researchLinks = page.locator('a[href^="/deep-search/"]')
    await expect(researchLinks).toHaveCount(2)
    for (const child of research) {
      const link = page.locator(
        `a[href="/deep-search/${child.deepSearchJobId}"]`,
      )
      await expect(link).toHaveAttribute("target", "_blank")
      await expect(link).toHaveAttribute("rel", "noopener noreferrer")
      await expect(link).toHaveText(child.researchRequest)
    }

    const replay = await request.get(`/api/idea-jobs/${ideaJobId}/events`)
    expect(replay.status()).toBe(200)
    const replayEvents = parseEvents<IdeaJobEvent>(await replay.text())
    expect(replayEvents.at(-1)).toEqual({ type: "done" })
    expect(
      replayEvents
        .filter((event) => event.type === "deep-search-started")
        .map((event) => event.deepSearchJobId)
        .toSorted(),
    ).toEqual(research.map((event) => event.deepSearchJobId).toSorted())
    expect(replayEvents.filter((event) => event.type === "idea")).toEqual(ideas)

    const detail = await request.get(`/api/idea-jobs/${ideaJobId}`)
    expect(detail.status()).toBe(200)
    expect(await detail.json()).toMatchObject({
      ideaJob: {
        ideaJobId,
        prompt,
        numberOfIdeas: 12,
        deepSearchCount: 2,
        stage: "ideas",
        status: "completed",
      },
    })

    await page.reload()
    const replayedIdeaStage = page.getByRole("button", {
      name: /Generate ideas/,
    })
    await expect(replayedIdeaStage).toContainText("Complete")
    await expect(replayedIdeaStage).toHaveAttribute("aria-expanded", "true")
    for (const idea of ideas) {
      await expect(
        page.getByRole("heading", { name: idea.title, exact: true }).first(),
      ).toBeVisible()
    }

    await page.goto("/ideas")
    await expect(
      page.getByRole("heading", { name: "Previous idea runs" }),
    ).toBeVisible()
    const historyLink = page.locator(`a[href="/ideas/${ideaJobId}"]`)
    await expect(historyLink).toBeVisible()
    await expect(historyLink).toContainText(prompt)
    await expect(historyLink).toContainText("Complete")
  })
})
