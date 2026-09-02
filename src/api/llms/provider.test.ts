import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reserveCodexGeneration: vi.fn(
    (_userId: string, _signal?: AbortSignal): Promise<unknown> =>
      Promise.resolve(undefined),
  ),
}))

vi.mock("../openaiConnection/codexGeneration.ts", () => ({
  reserveCodexGeneration: mocks.reserveCodexGeneration,
}))

import { createConfiguredLlm, reserveLlmCall } from "./provider.ts"

async function resolveReservedLlmCall(
  userId: string,
  reasoning: "enabled" | "disabled",
  modelOverride?: string,
) {
  const reservation = await reserveLlmCall(userId)
  return reservation.resolve(reasoning, modelOverride)
}

describe("configured LLM provider", () => {
  beforeEach(() => vi.clearAllMocks())

  it("preserves DeepSeek's call-level reasoning contract", () => {
    const llm = createConfiguredLlm({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "deepseek-key",
    })

    expect(llm.model().modelId).toBe("deepseek-v4-flash")
    expect(llm.supportsStructuredOutputs).toBe(true)
    expect(llm.model("deepseek-override").modelId).toBe("deepseek-override")
    expect(llm.callOptions("enabled")).toEqual({
      providerOptions: {
        deepseek: { thinking: { type: "enabled" }, reasoningEffort: "max" },
      },
    })
    expect(llm.callOptions("disabled")).toEqual({
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } },
      },
    })
  })

  it("translates Zen's call-level reasoning contract without making a request", () => {
    const llm = createConfiguredLlm({
      provider: "zen",
      model: "deepseek-v4-flash-free",
      apiKey: "zen-key",
      baseUrl: "https://opencode.ai/zen/v1",
    })

    expect(llm.model().modelId).toBe("deepseek-v4-flash-free")
    expect(llm.supportsStructuredOutputs).toBe(false)
    expect(llm.model()).toMatchObject({ supportsStructuredOutputs: false })
    expect(llm.model("zen-override").modelId).toBe("zen-override")
    expect(llm.callOptions("enabled")).toEqual({
      providerOptions: {
        zen: { reasoningEffort: "high" },
      },
    })
    expect(llm.callOptions("disabled")).toEqual({
      providerOptions: {
        zen: { reasoningEffort: "none" },
      },
    })
  })

  it("uses a connected Codex generation without server credit admission", async () => {
    const model = { modelId: "gpt-5.6-sol" }
    const wrapStream = vi.fn(<Part>(source: AsyncIterable<Part>) => source)
    const release = vi.fn(() => Promise.resolve())
    const acquire = vi.fn(() =>
      Promise.resolve({
        model,
        modelId: model.modelId,
        wrapStream,
        release,
      }),
    )
    mocks.reserveCodexGeneration.mockResolvedValueOnce({
      acquire,
      release: vi.fn(),
    })

    const call = await resolveReservedLlmCall(
      "connected-user-id",
      "enabled",
      "ignored-server-model",
    )

    expect(mocks.reserveCodexGeneration).toHaveBeenCalledWith(
      "connected-user-id",
      undefined,
    )
    expect(acquire).toHaveBeenCalledWith("enabled")
    expect(call).toMatchObject({
      model,
      modelId: "gpt-5.6-sol",
      provider: "codex",
      supportsStructuredOutputs: true,
      callOptions: {},
    })
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }
    expect(call.wrapStream(source)).toBe(source)
    await call.release()
    expect(wrapStream).toHaveBeenCalledWith(source)
    expect(release).toHaveBeenCalledOnce()
  })

  it("uses the configured server provider only when no connection exists", async () => {
    mocks.reserveCodexGeneration.mockResolvedValueOnce(undefined)

    const call = await resolveReservedLlmCall(
      "disconnected-user-id",
      "disabled",
      "deepseek-override",
    )

    expect(call.modelId).toBe("deepseek-override")
    expect(call.provider).toBe("server")
    expect(call.callOptions).toEqual({
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } },
      },
    })
  })

  it("propagates connected-provider errors instead of silently falling back", async () => {
    const error = new Error("Connected provider is rate limited")
    mocks.reserveCodexGeneration.mockResolvedValueOnce({
      acquire: vi.fn(() => Promise.reject(error)),
      release: vi.fn(),
    })

    await expect(
      resolveReservedLlmCall("connected-user-id", "enabled"),
    ).rejects.toBe(error)
  })
})
