import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  ideaSitePath,
  readIdeaSite,
  readIdeaSiteScreenshot,
  writeIdeaSite,
} from "./ideaSites.ts"

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
})
