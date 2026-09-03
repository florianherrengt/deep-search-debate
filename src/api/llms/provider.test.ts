import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reserveCodexGeneration: vi.fn(
    (_userId: string, _selection: unknown, _signal?: AbortSignal) =>
      Promise.resolve(undefined),
  ),
}))

vi.mock("../openaiConnection/codexGeneration.ts", () => ({
  reserveCodexGeneration: mocks.reserveCodexGeneration,
}))

import { createConfiguredLlm, reserveLlmCall } from "./provider.ts"
import type { LlmModelAssignmentSnapshot } from "./modelSettings.ts"

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

describe("configured LLM provider", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes the exact DeepSeek role effort", () => {
    const llm = createConfiguredLlm({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "deepseek-key",
    })

    expect(llm.model().modelId).toBe("deepseek-v4-flash")
    expect(llm.model("deepseek-v4-pro").modelId).toBe("deepseek-v4-pro")
    expect(llm.callOptions("xhigh")).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
          reasoningEffort: "xhigh",
        },
      },
    })
    expect(llm.callOptions("none")).toEqual({
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } },
      },
    })
  })

  it("preserves the configured Zen model while translating the role effort", () => {
    const llm = createConfiguredLlm({
      provider: "zen",
      model: "deepseek-v4-flash-free",
      apiKey: "zen-key",
      baseUrl: "https://opencode.ai/zen/v1",
    })

    expect(llm.model().modelId).toBe("deepseek-v4-flash-free")
    expect(llm.callOptions("medium")).toEqual({
      providerOptions: { zen: { reasoningEffort: "medium" } },
    })
  })

  it("uses an exact connected OpenAI model and effort", async () => {
    const model = { modelId: "gpt-5.6-sol" }
    const acquire = vi.fn(() =>
      Promise.resolve({
        model,
        modelId: model.modelId,
        wrapStream: <Part>(source: AsyncIterable<Part>) => source,
        release: () => Promise.resolve(),
      }),
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
      callOptions: {},
    })
  })

  it("uses an explicit DeepSeek choice even while OpenAI is connected", async () => {
    const reservation = await reserveLlmCall(
      "connected-user",
      deepSeekSnapshot,
    )
    const call = await reservation.resolve()

    expect(mocks.reserveCodexGeneration).not.toHaveBeenCalled()
    expect(call).toMatchObject({
      provider: "server",
      modelId: "deepseek-v4-flash",
    })
    expect(call.callOptions).toEqual({
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
          reasoningEffort: "medium",
        },
      },
    })
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
    const reservation = await reserveLlmCall(
      "connected-user",
      openAiSnapshot,
    )

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
