import type { APIRequestContext } from "@playwright/test"

import { expect, test } from "./fixtures.ts"
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
  test("stops an active root and cascades to its child searches", async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000)
    await page.goto("/ideas")
    const prompt =
      "[E2E_STOP_IDEA] Generate practical product ideas for London renters."
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/idea-jobs",
    )
    await page.getByLabel("Question, goal, or constraints").fill(prompt)
    await page.getByRole("button", { name: "Generate options" }).click()
    const created = await createdResponse
    const { ideaJobId, slug } = (await created.json()) as {
      ideaJobId: string
      slug: string
    }

    await expect(page.locator('a[href^="/deep-search/"]').first()).toBeVisible()
    await page.getByRole("button", { name: "Stop workflow" }).click()
    const dialog = page.getByRole("dialog", { name: "Stop this workflow?" })
    const cancellationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/idea-jobs/${ideaJobId}/cancel`,
    )
    await dialog.getByRole("button", { name: "Stop workflow" }).click()
    expect((await cancellationResponse).status()).toBe(202)

    await expect(page.getByText("Workflow stopped by user")).toBeVisible()
    await expect(page.getByText("Stopped").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop workflow" })).toHaveCount(0)
    await expect(page.getByRole("progressbar")).toHaveCount(0)

    const replay = await request.get(`/api/idea-jobs/${ideaJobId}/events`)
    const events = parseEvents<IdeaJobEvent>(await replay.text())
    expect(events.slice(-3)).toEqual([
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
    expect(events.some((event) => event.type === "error")).toBe(false)
    const children = events.filter(
      (event): event is Extract<IdeaJobEvent, { type: "deep-search-started" }> =>
        event.type === "deep-search-started",
    )
    expect(children).toHaveLength(2)
    for (const child of children) {
      const response = await request.get(`/api/deep-search-jobs/${child.slug}`)
      await expect(response.json()).resolves.toMatchObject({
        deepSearchJob: {
          status: "interrupted",
          stopRequested: true,
          canStop: false,
        },
      })
    }

    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/ideas/${slug}$`))
    await expect(page.getByText("Workflow stopped by user")).toBeVisible()
    await expect(page.getByText("Stopped").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop workflow" })).toHaveCount(0)
  })

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

    await page.getByLabel("Question, goal, or constraints").fill(prompt)
    await page.getByRole("button", { name: "Generate options" }).click()

    const created = await createdResponse
    expect(created.status()).toBe(202)
    expect(created.request().postDataJSON()).toEqual({
      prompt,
      numberOfIdeas: 8,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
    })

    const { ideaJobId, slug } = (await created.json()) as {
      ideaJobId: string
      slug: string
    }
    expect(ideaJobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers()["location"]).toBe(`/api/idea-jobs/${slug}`)
    await expect(page).toHaveURL(new RegExp(`/ideas/${slug}$`))
    await expect(
      page.getByRole("heading", { name: "London Renter Energy Products" }),
    ).toBeVisible()
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
    const evaluations = liveEvents.filter(
      (event) => event.type === "idea-evaluated",
    )
    const selection = liveEvents.find(
      (event) => event.type === "idea-selection-stream",
    )
    const selected = liveEvents.find(
      (event) => event.type === "selected-ideas",
    )
    const refinementGenerations = liveEvents.filter(
      (event) => event.type === "idea-refinement-stream",
    )
    const refinedIdeas = liveEvents.filter(
      (event) => event.type === "refined-idea",
    )
    const ideaResearch = liveEvents.filter(
      (
        event,
      ): event is Extract<
        IdeaJobEvent,
        { type: "idea-deep-search-started" }
      > => event.type === "idea-deep-search-started",
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
    expect(evaluations).toHaveLength(8)
    expect(ideas).toHaveLength(8)
    expect(selection).toBeDefined()
    expect(selected?.selectedIdeaIds).toHaveLength(8)
    expect(refinementGenerations).toHaveLength(8)
    expect(refinedIdeas).toHaveLength(8)
    expect(ideaResearch).toHaveLength(8)
    expect(new Set(ideaResearch.map(({ ideaId }) => ideaId))).toEqual(
      new Set(selected?.selectedIdeaIds),
    )
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
    const refinementStreams = await Promise.all(
      refinementGenerations.map((generation) =>
        readTextStream(request, generation.streamId),
      ),
    )
    expect(planningStream.text.trim()).not.toBe("")
    expect(summaryStream.text).toContain("insulation, heating-control")
    expect(summaryStream.text).toContain("Removable controls")
    expect(ideaStream.text.trim()).not.toBe("")
    const evaluationByIdeaId = new Map(
      evaluations.map((evaluation) => [evaluation.ideaId, evaluation]),
    )
    for (const [position, idea] of ideas.entries()) {
      const evaluation = evaluationByIdeaId.get(idea.ideaId)!
      expect(evaluation.pros).toContain(
        `Idea ${position + 1} has a clear renter-friendly mechanism.`,
      )
      expect(evaluation.cons).toContain(
        `Idea ${position + 1} needs stronger evidence of adoption.`,
      )
    }
    for (const refinementStream of refinementStreams) {
      const refined = JSON.parse(refinementStream.text) as {
        title: string
        description: string
      }
      expect(refined.title).toMatch(/^Improved Renter Energy Idea \d+$/)
      expect(refined.description).toContain("measurable adoption criteria")
    }

    const structuredIdeas = JSON.parse(ideaStream.text) as {
      elements: Array<{ title: string; description: string }>
    }
    expect(structuredIdeas.elements).toEqual(
      ideas.map(({ title, description }) => ({ title, description })),
    )

    for (const child of research) {
      const detail = await request.get(
        `/api/deep-search-jobs/${child.slug}`,
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
    for (const child of ideaResearch) {
      const detail = await request.get(`/api/deep-search-jobs/${child.slug}`)
      expect(detail.status()).toBe(200)
      expect(await detail.json()).toMatchObject({
        deepSearchJob: {
          deepSearchJobId: child.deepSearchJobId,
          ideaJobId,
          researchRequest: child.researchRequest,
          maxSearches: 3,
          maxResultsPerSearch: 3,
          status: "completed",
        },
      })
      const childReplay = await request.get(
        `/api/deep-search-jobs/${child.deepSearchJobId}/events`,
      )
      const childEvents = parseEvents<DeepSearchJobEvent>(
        await childReplay.text(),
      )
      const finalAnswer = childEvents.find(
        (event) => event.type === "final-answer-stream",
      )
      expect(childEvents.at(-1)).toEqual({ type: "done" })
      expect(finalAnswer).toBeDefined()
      const answer = await readTextStream(
        request,
        finalAnswer?.streamId ?? "",
      )
      const refined = refinedIdeas.find(({ ideaId }) => ideaId === child.ideaId)
      expect(answer.text).toContain(refined?.title ?? "missing refined title")
    }

    const ideaStage = page.getByRole("button", {
      name: /Generate and assess ideas/,
    })
    const progressStages = page.getByRole("group", {
      name: "Idea generation stages",
    })
    const progressStageGeometry = await progressStages
      .locator(":scope > *")
      .evaluateAll((stages) =>
        stages.map((stage, index) => {
          const bounds = stage.getBoundingClientRect()
          const previousBounds = stages[index - 1]?.getBoundingClientRect()
          const styles = getComputedStyle(stage)
          return {
            borderBottomWidth: Number.parseFloat(styles.borderBottomWidth),
            borderTopWidth: Number.parseFloat(styles.borderTopWidth),
            gap: previousBounds ? bounds.top - previousBounds.bottom : null,
            radiusBottomLeft: Number.parseFloat(styles.borderBottomLeftRadius),
            radiusBottomRight: Number.parseFloat(styles.borderBottomRightRadius),
            radiusTopLeft: Number.parseFloat(styles.borderTopLeftRadius),
            radiusTopRight: Number.parseFloat(styles.borderTopRightRadius),
          }
        }),
      )
    expect(progressStageGeometry).toHaveLength(4)
    expect(progressStageGeometry.slice(1).every(({ gap }) => gap === 0)).toBe(
      true,
    )
    expect(progressStageGeometry[0]?.radiusTopLeft).toBe(10)
    expect(progressStageGeometry[0]?.radiusTopRight).toBe(10)
    expect(progressStageGeometry.at(-1)?.radiusBottomLeft).toBe(10)
    expect(progressStageGeometry.at(-1)?.radiusBottomRight).toBe(10)
    expect(
      progressStageGeometry.slice(0, -1).every(
        ({ radiusBottomLeft, radiusBottomRight }) =>
          radiusBottomLeft === 0 && radiusBottomRight === 0,
      ),
    ).toBe(true)
    expect(
      progressStageGeometry.slice(1).every(
        ({ borderTopWidth }, index) =>
          borderTopWidth +
            (progressStageGeometry[index]?.borderBottomWidth ?? 0) ===
          1,
      ),
    ).toBe(true)
    await expect(ideaStage).toContainText("Complete")
    await expect(ideaStage).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByText("Raw structured output")).toHaveCount(0)
    for (const idea of ideas) {
      const refined = refinedIdeas.find(({ ideaId }) => ideaId === idea.ideaId)
      const ideaLink = page.getByRole("link", {
        name: `View ${refined?.title ?? idea.title}`,
        exact: true,
      })
      await expect(ideaLink).toHaveAttribute(
        "href",
        `/ideas/${slug}/${idea.ideaId}#improved-idea`,
      )
      await expect(ideaLink).not.toHaveAttribute("target", "_blank")
      await expect(
        page.getByRole("link", {
          name: `View selected ${idea.title}`,
          exact: true,
        }),
      ).toHaveCount(0)
      await expect(
        page.getByRole("link", {
          name: `View improved ${refined?.title ?? idea.title}`,
          exact: true,
        }),
      ).toHaveCount(0)
      await expect(
        page.getByText(refined?.description ?? idea.description, { exact: true }),
      ).toBeVisible()
    }
    for (const child of ideaResearch) {
      await expect(
        page.getByTestId(`idea-research-${child.deepSearchJobId}`),
      ).toHaveCount(0)
    }
    await expect(
      page.getByRole("button", { name: /Critique each idea/ }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: /Select ideas/ }),
    ).toHaveCount(0)
    await ideaStage.click()
    await expect(ideaStage).toHaveAttribute("aria-expanded", "true")
    await expect(
      page.getByRole("heading", { name: /Why these ideas were selected/ }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "Selection reasoning" }),
    ).toHaveCount(0)
    await expect(page.getByText("selectedIdeaIds")).toHaveCount(0)
    await expect(
      page.getByText("8 of 8 ideas selected for improvement."),
    ).toBeVisible()

    await expect(
      page.getByRole("button", {
        name: /Improve and research selected ideas/,
      }),
    ).toHaveCount(0)

    const firstIdea = ideas[0]
    const firstRefined = refinedIdeas.find(
      ({ ideaId }) => ideaId === firstIdea.ideaId,
    )!
    const firstResearch = ideaResearch.find(
      ({ ideaId }) => ideaId === firstIdea.ideaId,
    )!
    await page
      .getByRole("link", {
        name: `View ${firstRefined.title}`,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/ideas/${slug}/${firstIdea.ideaId}#improved-idea$`),
    )
    await expect(
      page.getByRole("heading", { level: 1, name: firstRefined.title }),
    ).toBeVisible()
    const improvedHeading = page.getByRole("heading", {
      level: 2,
      name: "Improved idea",
    })
    await expect(improvedHeading).toBeFocused()
    const developmentStage = page.getByRole("button", {
      name: "How this idea was developed",
    })
    await expect(developmentStage).toHaveAttribute("aria-expanded", "false")
    await developmentStage.click()
    await expect(developmentStage).toHaveAttribute("aria-expanded", "true")
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "Original idea",
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(firstIdea.description, { exact: true }),
    ).toBeVisible()
    const firstEvaluation = evaluations.find(
      (evaluation) => evaluation.ideaId === firstIdea.ideaId,
    )
    await expect(page.getByTestId("idea-assessment-0")).toBeVisible()
    await expect(
      page.getByText(firstEvaluation?.pros[0] ?? "missing pro"),
    ).toBeVisible()
    await expect(
      page.getByText(firstEvaluation?.cons[0] ?? "missing con"),
    ).toBeVisible()
    await expect(
      page.getByTestId(`idea-research-${firstResearch.deepSearchJobId}`),
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Open full research" }),
    ).toHaveAttribute("href", `/deep-search/${firstResearch.slug}`)

    await page.reload()
    await expect(
      page.getByRole("heading", { level: 1, name: firstRefined.title }),
    ).toBeVisible()
    await expect(improvedHeading).toBeFocused()
    await expect(developmentStage).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByTestId("idea-assessment-0")).toBeHidden()
    await developmentStage.click()
    await expect(developmentStage).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByTestId("idea-assessment-0")).toBeVisible()
    await expect(
      page.getByText(firstEvaluation?.critique ?? "missing analysis"),
    ).toBeVisible()
    await page.getByRole("link", { name: "Back to ideas" }).click()
    await expect(page).toHaveURL(new RegExp(`/ideas/${slug}$`))

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
        `a[href="/deep-search/${child.slug}"]`,
      )
      await expect(link).toHaveAttribute("target", "_blank")
      await expect(link).toHaveAttribute("rel", "noopener noreferrer")
      await expect(link).toContainText(child.title)
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
    expect(
      replayEvents
        .filter((event) => event.type === "idea-evaluated")
        .toSorted((first, second) => first.ideaId.localeCompare(second.ideaId)),
    ).toEqual(
      evaluations.toSorted((first, second) =>
        first.ideaId.localeCompare(second.ideaId),
      ),
    )
    expect(
      replayEvents
        .filter((event) => event.type === "refined-idea")
        .toSorted((first, second) => first.ideaId.localeCompare(second.ideaId)),
    ).toEqual(
      refinedIdeas.toSorted((first, second) =>
        first.ideaId.localeCompare(second.ideaId),
      ),
    )
    expect(
      replayEvents
        .filter((event) => event.type === "idea-deep-search-started")
        .toSorted((first, second) => first.ideaId.localeCompare(second.ideaId)),
    ).toEqual(
      ideaResearch.toSorted((first, second) =>
        first.ideaId.localeCompare(second.ideaId),
      ),
    )

    const detail = await request.get(`/api/idea-jobs/${slug}`)
    expect(detail.status()).toBe(200)
    expect(await detail.json()).toMatchObject({
      ideaJob: {
        ideaJobId,
        prompt,
        numberOfIdeas: 8,
        deepSearchCount: 2,
        stage: "ideas",
        status: "completed",
      },
    })

    await page.reload()
    const replayedIdeaStage = page.getByRole("button", {
      name: /Generate and assess ideas/,
    })
    await expect(replayedIdeaStage).toContainText("Complete")
    await expect(replayedIdeaStage).toHaveAttribute("aria-expanded", "false")
    await expect(
      page.getByRole("button", {
        name: /Improve and research selected ideas/,
      }),
    ).toHaveCount(0)
    for (const refined of refinedIdeas) {
      await expect(
        page.getByRole("link", {
          name: `View ${refined.title}`,
          exact: true,
        }),
      ).toBeVisible()
    }

    await page.goto("/ideas")
    await expect(
      page.getByRole("heading", { name: "Previous option runs" }),
    ).toBeVisible()
    const historyLink = page.locator(`a[href="/ideas/${slug}"]`)
    await expect(historyLink).toBeVisible()
    await expect(historyLink).toContainText("London Renter Energy Products")
    await expect(historyLink).toContainText(prompt)
    await expect(historyLink).toContainText("Complete")
  })
})
