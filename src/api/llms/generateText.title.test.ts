import {
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
} from "./generateText.testSupport.ts"
import { beforeEach, describe, expect, it } from "vitest"
import z from "zod"

import { config } from "../config.ts"
import { generatePromptTitle } from "./generateText.ts"

describe("generatePromptTitle", () => {
  beforeEach(resetGenerateTextMocks)

  it("generates a structured title with the configured model", async () => {
    const stream = { id: "raw-stream" }
    const output = Promise.resolve({ title: "London Renter Energy Options" })
    const finishReason = Promise.resolve("stop" as const)
    const usage = Promise.resolve({ inputTokens: 12, outputTokens: 4 })
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mocks.streamText.mockReturnValue({
      stream,
      output,
      finishReason,
      usage,
    })
    const prepared = mockPreparedGeneration()

    await expect(generatePromptTitle("test-user-id", "How can renters save energy?")).resolves.toBe(
      "London Renter Energy Options",
    )
    const titleOptions = z
      .object({
        timeout: z.object({ totalMs: z.number() }),
        maxRetries: z.number(),
        providerOptions: z.object({
          test: z.object({ reasoning: z.literal("disabled") }),
        }),
      })
      .loose()
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(titleOptions.timeout.totalMs).toBe(
      config.llmExecution.totalTimeoutMs,
    )
    expect(titleOptions.maxRetries).toBe(config.llmExecution.maxRetries)
    expect(mocks.model).toHaveBeenCalledWith(undefined)
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
    expect(mocks.outputObject).toHaveBeenCalledOnce()
    expect(prepared.start).toHaveBeenCalledWith(stream, {
      finishReason,
      usage,
    })
    const titleCall = z
      .object({ system: z.string() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(titleCall.system).toContain("Title system prompt")
    expect(titleCall.system).toContain('"title"')
  })

  it("rejects a title that did not finish normally", async () => {
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mocks.streamText.mockReturnValue({
      stream: { id: "raw-stream" },
      output: Promise.resolve({ title: "Truncated title" }),
      finishReason: Promise.resolve("length"),
    })
    mockPreparedGeneration({
      id: "stream-id",
      completion: Promise.resolve({
        status: "failed" as const,
        text: "partial",
        reasoning: "",
        error: 'Text generation ended with finish reason "length"',
        failureKind: "finish-reason" as const,
      }),
    })

    await expect(generatePromptTitle("test-user-id", "Research this topic")).rejects.toThrow(
      'Text generation ended with finish reason "length"',
    )
  })
})
