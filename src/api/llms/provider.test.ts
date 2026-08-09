import { describe, expect, it } from "vitest"
import { createConfiguredLlm } from "./provider.ts"

describe("configured LLM provider", () => {
  it("preserves DeepSeek's call-level reasoning contract", () => {
    const llm = createConfiguredLlm({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "deepseek-key",
    })

    expect(llm.model().modelId).toBe("deepseek-v4-flash")
    expect(llm.model("deepseek-override").modelId).toBe("deepseek-override")
    expect(llm.callOptions("enabled")).toEqual({
      providerOptions: {
        deepseek: { thinking: { type: "enabled" } },
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
})
