import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reserveCodexGeneration: vi.fn(
    (_userId: string, _selection: unknown, _signal?: AbortSignal) =>
      Promise.resolve(undefined),
  ),
  startPiLlmStream: vi.fn((_runtime: unknown, _request: unknown) => ({
    stream: {},
  })),
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
  explicit: true,
  assignment: {
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    reasoningEffort: "medium",
  },
}

const openAiSnapshot: LlmModelAssignmentSnapshot = {
  role: "big",
  explicit: true,
  assignment: {
    provider: "openai",
    modelId: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
}

describe("configured Pi LLM provider", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uses Pi's DeepSeek models and enables exact reasoning effort passthrough", () => {
    const llm = createConfiguredLlm({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "deepseek-key",
    })

    expect(llm.model().id).toBe("deepseek-v4-flash")
    expect(llm.model("deepseek-v4-pro").id).toBe("deepseek-v4-pro")
    expect(llm.model().compat).toMatchObject({
      thinkingFormat: "deepseek",
      supportsReasoningEffort: true,
    })
  })

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

  it("uses Pi for an explicit DeepSeek choice while OpenAI is connected", async () => {
    const reservation = await reserveLlmCall("connected-user", deepSeekSnapshot)
    const call = await reservation.resolve()
    const request = { system: "system", prompt: "prompt", maxOutputTokens: 100 }

    call.start(request)

    expect(mocks.reserveCodexGeneration).not.toHaveBeenCalled()
    expect(call).toMatchObject({
      provider: "server",
      modelId: "deepseek-v4-flash",
    })
    expect(mocks.startPiLlmStream).toHaveBeenCalledOnce()
    const [runtime, sentRequest] = mocks.startPiLlmStream.mock.calls[0] ?? []
    const runtimeRecord = requireRecord(runtime)
    expect(runtimeRecord.provider).toBe("server")
    expect(runtimeRecord.apiKey).toBeTypeOf("string")
    expect(runtimeRecord.reasoningEffort).toBe("medium")
    expect(requireRecord(runtimeRecord.model).id).toBe("deepseek-v4-flash")
    expect(sentRequest).toEqual(request)
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

  it("falls back only for an unavailable implicit OpenAI recommendation", async () => {
    const implicit = { ...openAiSnapshot, explicit: false } as const
    mocks.reserveCodexGeneration.mockResolvedValueOnce({
      acquire: vi.fn(() => Promise.resolve(undefined)),
      release: vi.fn(),
    } as never)

    const reservation = await reserveLlmCall("connected-user", implicit)
    const call = await reservation.resolve()

    expect(call).toMatchObject({
      provider: "server",
      modelId: "deepseek-v4-pro",
    })
  })
})
