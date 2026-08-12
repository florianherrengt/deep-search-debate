import type { LanguageModelUsage } from "ai"
import { MICRO_USD_PER_CREDIT } from "../../credits.ts"

const tokensPerMillion = 1_000_000

// DeepSeek V4 Flash prices published per million tokens in August 2026.
// Source: https://api-docs.deepseek.com/quick_start/pricing/
const microUsdPerMillionTokens = {
  cacheHitInput: 2_800,
  cacheMissInput: 140_000,
  output: 280_000,
} as const

function requireTokenCount(
  value: number | undefined,
  field: string,
): number {
  if (value === undefined) {
    throw new Error(`Cannot calculate DeepSeek V4 Flash cost without ${field}`)
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid DeepSeek V4 Flash ${field}: ${value}`)
  }
  return value
}

/** Calculates one DeepSeek V4 Flash generation's cost in integer micro-USD. */
export function calculateDeepSeekV4FlashCostMicroUsd(
  usage: LanguageModelUsage,
): number {
  const cacheHitInputTokens = requireTokenCount(
    usage.inputTokenDetails.cacheReadTokens,
    "cache-hit input token count",
  )
  const cacheMissInputTokens = requireTokenCount(
    usage.inputTokenDetails.noCacheTokens,
    "cache-miss input token count",
  )
  const outputTokens = requireTokenCount(
    usage.outputTokens,
    "output token count",
  )

  const weightedMicroUsd =
    cacheHitInputTokens * microUsdPerMillionTokens.cacheHitInput +
    cacheMissInputTokens * microUsdPerMillionTokens.cacheMissInput +
    outputTokens * microUsdPerMillionTokens.output

  if (!Number.isSafeInteger(weightedMicroUsd)) {
    throw new Error("DeepSeek V4 Flash cost exceeded safe integer precision")
  }

  return Math.ceil(weightedMicroUsd / tokensPerMillion)
}

/** Converts actual provider usage to the product's $1 / 1,000-credit base. */
export function calculateDeepSeekV4FlashCredits(
  usage: LanguageModelUsage,
): number {
  return Math.ceil(
    calculateDeepSeekV4FlashCostMicroUsd(usage) / MICRO_USD_PER_CREDIT,
  )
}
