import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"

const mocks = vi.hoisted(() => ({
  awaitGenerationText: vi.fn(),
  browserClose: vi.fn(),
  generateTextStream: vi.fn(),
  pageGoto: vi.fn(),
  pageScreenshot: vi.fn(),
  pageSetViewport: vi.fn(),
  puppeteerLaunch: vi.fn(),
}))

vi.mock("puppeteer", () => ({
  default: { launch: mocks.puppeteerLaunch },
}))
vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))
vi.mock("../../llms/streams.ts", () => ({
  awaitGenerationText: mocks.awaitGenerationText,
}))

import {
  generateIdeaSite,
  generateWinningIdeaSite,
  ideaSitePath,
  readIdeaSite,
  readIdeaSiteScreenshot,
  writeIdeaSite,
} from "./ideaSites.ts"
import { db } from "../../db/index.ts"
import {
  debateJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import { PromptName } from "../../llms/prompts.ts"

function mockSuccessfulLaunch(png: Uint8Array): void {
  mocks.puppeteerLaunch.mockResolvedValue({
    close: mocks.browserClose,
    newPage: () => ({
      goto: mocks.pageGoto,
      screenshot: mocks.pageScreenshot.mockResolvedValue(png),
      setViewport: mocks.pageSetViewport,
    }),
  })
}

function mockFailingLaunch(): void {
  mocks.puppeteerLaunch.mockRejectedValue(
    new Error("No usable sandbox available"),
  )
}

describe("idea sites", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stores each website under its idea directory and reads it back", async () => {
    const ideaId = crypto.randomUUID()
    const html = "<!DOCTYPE html><html><body>Idea site</body></html>"

    await writeIdeaSite(ideaId, html)

    expect(existsSync(ideaSitePath(ideaId))).toBe(true)
    await expect(readIdeaSite(ideaId)).resolves.toBe(html)
  })

  it("returns undefined when no website was generated", async () => {
    await expect(readIdeaSite(crypto.randomUUID())).resolves.toBeUndefined()
  })

  it("captures a square screenshot after generating the website", async () => {
    const ideaId = crypto.randomUUID()
    const html = "<!DOCTYPE html><html><body>Idea site</body></html>"
    const png = new Uint8Array([1, 2, 3])
    mocks.generateTextStream.mockResolvedValue({ llmGenerationId: "gen-1" })
    mocks.awaitGenerationText.mockResolvedValue(html)
    mockSuccessfulLaunch(png)

    await generateIdeaSite({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Generate ideas",
      researchSummary: "Research briefing",
      idea: {
        ideaId,
        refinedTitle: "Refined title",
        refinedDescription: "Refined description",
      },
    })

    expect(mocks.pageSetViewport).toHaveBeenCalledWith(
      expect.objectContaining({ height: 1024, width: 1024 }),
    )
    expect(mocks.pageGoto).toHaveBeenCalledWith(
      pathToFileURL(ideaSitePath(ideaId)).href,
      expect.objectContaining({ waitUntil: "load" }),
    )
    await expect(readIdeaSiteScreenshot(ideaId)).resolves.toEqual(png)
    expect(mocks.browserClose).toHaveBeenCalledTimes(1)
  })

  it("keeps the generated website when the screenshot capture fails", async () => {
    const ideaId = crypto.randomUUID()
    const html = "<!DOCTYPE html><html><body>Resilient site</body></html>"
    mocks.generateTextStream.mockResolvedValue({ llmGenerationId: "gen-1" })
    mocks.awaitGenerationText.mockResolvedValue(html)
    mockFailingLaunch()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      generateIdeaSite({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: "Generate ideas",
        researchSummary: "Research briefing",
        idea: {
          ideaId,
          refinedTitle: "Refined title",
          refinedDescription: "Refined description",
        },
      }),
    ).resolves.toBeUndefined()

    await expect(readIdeaSite(ideaId)).resolves.toBe(html)
    await expect(readIdeaSiteScreenshot(ideaId)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("returns undefined when no screenshot was captured", async () => {
    await expect(
      readIdeaSiteScreenshot(crypto.randomUUID()),
    ).resolves.toBeUndefined()
  })

  it("restores a missing winner file from completed generation text without a provider call", async () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    const summaryGenerationId = crypto.randomUUID()
    const refinementGenerationId = crypto.randomUUID()
    const websiteGenerationId = crypto.randomUUID()
    const html = "<!DOCTYPE html><html><body>Recovered winner</body></html>"
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 17 })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        slug: `recovered-${ideaJobId}`,
        prompt: "Choose a resilient product",
        numberOfIdeas: 6,
        deepSearchCount: 1,
        maxSearches: 2,
        maxResultsPerSearch: 2,
        maxRounds: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values([
        {
          llmGenerationId: summaryGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed",
          text: "Research briefing",
          reasoning: "",
          completedAt: new Date(),
        },
        {
          llmGenerationId: websiteGenerationId,
          userId: "test-user-id",
          debateJobId,
          promptName: PromptName.CreateIdeaSite,
          status: "completed",
          text: html,
          reasoning: "",
          completedAt: new Date(),
        },
        {
          llmGenerationId: refinementGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed",
          text: "Refined idea",
          reasoning: "",
          completedAt: new Date(),
        },
      ])
      .run()
    db.update(ideaJobs)
      .set({ researchSummaryGenerationId: summaryGenerationId })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Winner",
        description: "Original description",
        selected: true,
        refinementGenerationId,
        refinedTitle: "Refined winner",
        refinedDescription: "Refined description",
      })
      .run()
    db.update(debateJobs)
      .set({ websiteGenerationId })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
    mockSuccessfulLaunch(new Uint8Array([1, 2, 3]))

    await generateWinningIdeaSite({
      userId: "test-user-id",
      debateJobId,
      winnerIdeaId: ideaId,
    })

    await expect(readIdeaSite(ideaId)).resolves.toBe(html)
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
  })

  it("atomically interrupts and replaces an exact stale winner generation", async () => {
    const debateJobId = crypto.randomUUID()
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    const summaryGenerationId = crypto.randomUUID()
    const refinementGenerationId = crypto.randomUUID()
    const staleGenerationId = crypto.randomUUID()
    const retryGenerationId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({ debateJobId, userId: "test-user-id", randomSeed: 18 })
      .run()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        debateJobId,
        userId: "test-user-id",
        slug: `retry-${ideaJobId}`,
        prompt: "Choose a recoverable product",
        numberOfIdeas: 6,
        deepSearchCount: 1,
        maxSearches: 2,
        maxResultsPerSearch: 2,
        maxRounds: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values([
        {
          llmGenerationId: summaryGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed",
          text: "Research briefing",
          reasoning: "",
          completedAt: new Date(),
        },
        {
          llmGenerationId: refinementGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed",
          text: "Refined idea",
          reasoning: "",
          completedAt: new Date(),
        },
        {
          llmGenerationId: staleGenerationId,
          userId: "test-user-id",
          debateJobId,
          promptName: PromptName.CreateIdeaSite,
        },
      ])
      .run()
    db.update(ideaJobs)
      .set({ researchSummaryGenerationId: summaryGenerationId })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Winner",
        description: "Original description",
        selected: true,
        refinementGenerationId,
        refinedTitle: "Refined winner",
        refinedDescription: "Refined description",
      })
      .run()
    db.update(debateJobs)
      .set({ websiteGenerationId: staleGenerationId })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
    mocks.generateTextStream.mockImplementation((input: {
      onRegistered?: (
        id: string,
        transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
      ) => void
    }) => {
      db.transaction((transaction) => {
        transaction
          .insert(llmGenerations)
          .values({
            llmGenerationId: retryGenerationId,
            userId: "test-user-id",
            debateJobId,
            promptName: PromptName.CreateIdeaSite,
          })
          .run()
        input.onRegistered?.(retryGenerationId, transaction)
      })
      return Promise.resolve({ id: retryGenerationId })
    })
    mocks.awaitGenerationText.mockResolvedValue(
      "<!DOCTYPE html><html><body>Retried winner</body></html>",
    )
    mockSuccessfulLaunch(new Uint8Array([1, 2, 3]))

    await generateWinningIdeaSite({
      userId: "test-user-id",
      debateJobId,
      winnerIdeaId: ideaId,
    })

    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, staleGenerationId))
        .get(),
    ).toEqual({ status: "interrupted" })
    expect(
      db
        .select({ websiteGenerationId: debateJobs.websiteGenerationId })
        .from(debateJobs)
        .where(eq(debateJobs.debateJobId, debateJobId))
        .get(),
    ).toEqual({ websiteGenerationId: retryGenerationId })
    expect(mocks.generateTextStream).toHaveBeenCalledOnce()
  })
})
