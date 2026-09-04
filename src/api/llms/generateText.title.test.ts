import {
  completedGenerationHandle,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
  startedLlmStream,
} from "./generateText.testSupport.ts"
import { beforeEach, describe, expect, it } from "vitest"

import { generatePromptTitle } from "./generateText.ts"

describe("generatePromptTitle", () => {
  beforeEach(resetGenerateTextMocks)

  it("uses the Small model assignment and parses the persisted title", async () => {
    const started = startedLlmStream()
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mocks.start.mockReturnValue(started)
    const prepared = mockPreparedGeneration(
      completedGenerationHandle(
        '{"title":"London Renter Energy Options"}',
      ),
    )

    await expect(
      generatePromptTitle("test-user-id", "How can renters save energy?"),
    ).resolves.toBe("London Renter Energy Options")

    expect(mocks.reserveLlmCall).toHaveBeenCalledWith(
      "test-user-id",
      {
        role: "small",
        assignment: {
          provider: "deepseek",
          modelId: "deepseek-v4-flash",
          reasoningEffort: "medium",
        },
        explicit: false,
      },
      undefined,
    )
    const request = mocks.start.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      prompt: "<user_request>\nHow can renters save energy?\n</user_request>",
      maxOutputTokens: 50,
    })
    expect(request?.system).toContain("Title system prompt")
    expect(request?.system).toContain('"title"')
    expect(request?.jsonSchema).toMatchObject({ properties: { title: {} } })
    expect(prepared.start).toHaveBeenCalledWith(started.stream, {
      finishReason: started.finishReason,
      rawFinishReason: started.rawFinishReason,
      usage: started.usage,
    })
  })

  it("rejects a title whose durable generation failed", async () => {
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mockPreparedGeneration({
      id: "stream-id",
      completion: Promise.resolve({
        status: "failed" as const,
        text: '{"title":"Truncated title"}',
        reasoning: "",
        error: 'Text generation ended with finish reason "length"',
        failureKind: "finish-reason" as const,
      }),
    })

    await expect(
      generatePromptTitle("test-user-id", "Research this topic"),
    ).rejects.toThrow('Text generation ended with finish reason "length"')
  })

  it("rejects a persisted title outside the title contract", async () => {
    mocks.loadPrompt.mockResolvedValue("Title system prompt")
    mockPreparedGeneration(
      completedGenerationHandle(
        JSON.stringify({ title: "x".repeat(81) }),
      ),
    )

    await expect(
      generatePromptTitle("test-user-id", "Research this topic"),
    ).rejects.toThrow()
  })
})
