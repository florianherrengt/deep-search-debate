import type { LanguageModelUsage } from "ai"
import { describe, expect, it } from "vitest"

import { calculateLlmCredits } from "./index.ts"

const usage: LanguageModelUsage = {
  inputTokens: 10,
  inputTokenDetails: {
    noCacheTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: undefined,
  },
  outputTokens: 5,
  outputTokenDetails: {
    textTokens: 5,
    reasoningTokens: 0,
  },
  totalTokens: 15,
}

describe("calculateLlmCredits", () => {
  it("does not apply product-credit billing to development-only Zen calls", () => {
    expect(
      calculateLlmCredits(
        {
          provider: "zen",
          model: "deepseek-v4-flash-free",
          apiKey: "test-key",
          baseUrl: "https://opencode.ai/zen/v1",
        },
        "deepseek-v4-flash-free",
        usage,
      ),
    ).toBe(0)
  })

  it("rejects an unpriced DeepSeek model", () => {
    expect(() =>
      calculateLlmCredits(
        {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          apiKey: "test-key",
        },
        "deepseek-v4-pro",
        usage,
      ),
    ).toThrow("No credit pricing function exists for deepseek-v4-pro")
  })
})
