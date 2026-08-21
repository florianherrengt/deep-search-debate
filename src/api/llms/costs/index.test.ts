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
  it("charges one product credit for development-only Zen calls", () => {
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
    ).toBe(1)
  })

  it("prices DeepSeek V4 Pro usage", () => {
    expect(
      calculateLlmCredits(
        {
          provider: "deepseek",
          model: "deepseek-v4-pro",
          apiKey: "test-key",
        },
        "deepseek-v4-pro",
        {
          ...usage,
          inputTokens: 110_000,
          inputTokenDetails: {
            noCacheTokens: 100_000,
            cacheReadTokens: 10_000,
            cacheWriteTokens: undefined,
          },
          outputTokens: 5_000,
          outputTokenDetails: {
            textTokens: 5_000,
            reasoningTokens: 0,
          },
          totalTokens: 115_000,
        },
      ),
    ).toBe(48)
  })

  it("rejects an unpriced DeepSeek model", () => {
    expect(() =>
      calculateLlmCredits(
        {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          apiKey: "test-key",
        },
        "unsupported-deepseek-model",
        usage,
      ),
    ).toThrow(
      "No credit pricing function exists for unsupported-deepseek-model",
    )
  })
})
