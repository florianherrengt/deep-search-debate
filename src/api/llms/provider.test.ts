import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reserveCodexGeneration: vi.fn(
    (_userId: string, _selection: unknown, _signal?: AbortSignal) =>
      Promise.resolve(undefined),
  ),
  startPiLlmStream: vi.fn((_runtime: unknown, _request: unknown) => ({
    stream: {},
  })),
  getDeepSeekApiKey: vi.fn<() => string | undefined>(() => "user-deepseek-key"),
}))

vi.mock("../deepseekConnection/keysRepository.ts", () => ({
  getDeepSeekApiKey: mocks.getDeepSeekApiKey,
}))

vi.mock("../openaiConnection/codexGeneration.ts", () => ({
  reserveCodexGeneration: mocks.reserveCodexGeneration,
}))

vi.mock("./piGeneration.ts", () => ({
  startPiLlmStream: mocks.startPiLlmStream,
}))

import { createConfiguredLlm, reserveLlmCall } from "./provider.ts"
import type { LlmModelAssignmentSnapshot } from "./modelSettings.ts"

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Expected a record")
  }
  return value as Record<string, unknown>
}

const deepSeekSnapshot: LlmModelAssignmentSnapshot = {
  role: "small",
  assignment: {
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    reasoningEffort: "medium",
  },
}

const openAiSnapshot: LlmModelAssignmentSnapshot = {
  role: "big",
  assignment: {
    provider: "openai",
    modelId: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
}

describe("configured Pi LLM provider", () => {
  beforeEach(() => vi.clearAllMocks())

  it("preserves the configured arbitrary Zen model in Pi", () => {
    const llm = createConfiguredLlm({
      provider: "zen",
      model: "deepseek-v4-flash-free",
      apiKey: "zen-key",
      baseUrl: "https://opencode.ai/zen/v1",
    })

    expect(llm.model()).toMatchObject({
      id: "deepseek-v4-flash-free",
      provider: "opencode",
      api: "openai-completions",
      baseUrl: "https://opencode.ai/zen/v1",
      compat: { supportsReasoningEffort: true },
    })
  })

  it("uses an exact connected OpenAI model and effort", async () => {
    const start = vi.fn()
    const release = vi.fn(() => Promise.resolve())
    const acquire = vi.fn(() =>
      Promise.resolve({ modelId: "gpt-5.6-sol", start, release }),
    )
    mocks.reserveCodexGeneration.mockResolvedValueOnce({
      acquire,
      release: vi.fn(),
    } as never)

    const reservation = await reserveLlmCall("connected-user", openAiSnapshot)
    const call = await reservation.resolve()

    expect(mocks.reserveCodexGeneration).toHaveBeenCalledWith(
      "connected-user",
      {
        modelId: "gpt-5.6-sol",
        reasoningEffort: "xhigh",
        allowUnavailableRecommendationFallback: false,
      },
      undefined,
    )
    expect(acquire).toHaveBeenCalledOnce()
    expect(call).toMatchObject({
      provider: "codex",
      modelId: "gpt-5.6-sol",
      start,
      release,
    })
  })

  it("uses the user's DeepSeek key and supports a selected V4.1 ID", async () => {
    const selected = {
      ...deepSeekSnapshot,
      assignment: { ...deepSeekSnapshot.assignment, modelId: "deepseek-v4.1" },
    }
    const reservation = await reserveLlmCall("connected-user", selected)
    const call = await reservation.resolve()
    const request = { system: "system", prompt: "prompt" }

    call.start(request)

    expect(mocks.reserveCodexGeneration).not.toHaveBeenCalled()
    expect(call).toMatchObject({
      provider: "server",
      modelId: "deepseek-v4.1",
    })
    expect(mocks.startPiLlmStream).toHaveBeenCalledOnce()
    const [runtime, sentRequest] = mocks.startPiLlmStream.mock.calls[0] ?? []
    const runtimeRecord = requireRecord(runtime)
    expect(runtimeRecord.provider).toBe("server")
    expect(runtimeRecord.apiKey).toBe("user-deepseek-key")
    expect(runtimeRecord.reasoningEffort).toBe("medium")
    expect(requireRecord(runtimeRecord.model)).toMatchObject({
      id: "deepseek-v4.1",
      provider: "deepseek",
      compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true },
    })
    expect(sentRequest).toEqual(request)
  })

  it("rechecks the user's DeepSeek key when a queued call resolves", async () => {
    const reservation = await reserveLlmCall("connected-user", deepSeekSnapshot)
    mocks.getDeepSeekApiKey.mockReturnValueOnce(undefined)

    expect(() => reservation.resolve()).toThrow(expect.objectContaining({
      code: "deepseek-key-required",
    }))
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("fails an explicit OpenAI choice when the connection is absent", async () => {
    mocks.reserveCodexGeneration.mockResolvedValueOnce(undefined)

    await expect(
      reserveLlmCall("disconnected-user", openAiSnapshot),
    ).rejects.toMatchObject({ code: "authentication-required" })
  })

  it("fails an explicit OpenAI choice when the connection disappears after reservation", async () => {
    mocks.reserveCodexGeneration.mockResolvedValueOnce({
      acquire: vi.fn(() => Promise.resolve(undefined)),
      release: vi.fn(),
    } as never)
    const reservation = await reserveLlmCall("connected-user", openAiSnapshot)

    await expect(reservation.resolve()).rejects.toMatchObject({
      code: "authentication-required",
    })
  })

})
