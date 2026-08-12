import type { LanguageModelUsage } from "ai"
import { describe, expect, it } from "vitest"

import {
  calculateDeepSeekV4FlashCostMicroUsd,
  calculateDeepSeekV4FlashCredits,
} from "./deepseekV4Flash.ts"

function createUsage(input: {
  cacheHitInputTokens?: number
  cacheMissInputTokens?: number
  outputTokens?: number
}): LanguageModelUsage {
  const cacheHitInputTokens = input.cacheHitInputTokens ?? 0
  const cacheMissInputTokens = input.cacheMissInputTokens ?? 0
  const outputTokens = input.outputTokens ?? 0

  return {
    inputTokens: cacheHitInputTokens + cacheMissInputTokens,
    inputTokenDetails: {
      noCacheTokens: cacheMissInputTokens,
      cacheReadTokens: cacheHitInputTokens,
      cacheWriteTokens: undefined,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: outputTokens,
      reasoningTokens: 0,
    },
    totalTokens:
      cacheHitInputTokens + cacheMissInputTokens + outputTokens,
  }
}

describe("calculateDeepSeekV4FlashCostMicroUsd", () => {
  it("calculates the documented mixed-usage example", () => {
    const usage = createUsage({
        cacheMissInputTokens: 100_000,
        cacheHitInputTokens: 10_000,
        outputTokens: 5_000,
      })
    const cost = calculateDeepSeekV4FlashCostMicroUsd(usage)

    expect(cost).toBe(15_428)
    expect(calculateDeepSeekV4FlashCredits(usage)).toBe(16)
  })

  it.each([
    ["cache-hit input", { cacheHitInputTokens: 1_000_000 }, 2_800],
    ["cache-miss input", { cacheMissInputTokens: 1_000_000 }, 140_000],
    ["output", { outputTokens: 1_000_000 }, 280_000],
  ])("applies the %s rate", (_name, usage, expectedCost) => {
    expect(
      calculateDeepSeekV4FlashCostMicroUsd(createUsage(usage)),
    ).toBe(expectedCost)
  })

  it("rounds fractional micro-USD up", () => {
    expect(
      calculateDeepSeekV4FlashCostMicroUsd(
        createUsage({ cacheHitInputTokens: 1 }),
      ),
    ).toBe(1)
  })

  it("rejects incomplete provider usage", () => {
    const usage = createUsage({ outputTokens: 10 })
    usage.inputTokenDetails.cacheReadTokens = undefined

    expect(() => calculateDeepSeekV4FlashCostMicroUsd(usage)).toThrow(
      "cache-hit input token count",
    )
  })

  it("rejects invalid token counts", () => {
    const usage = createUsage({ outputTokens: 10 })
    usage.outputTokens = -1

    expect(() => calculateDeepSeekV4FlashCostMicroUsd(usage)).toThrow(
      "Invalid DeepSeek V4 Flash output token count",
    )
  })
})
