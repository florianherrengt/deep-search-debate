import type { LanguageModelUsage } from "ai"
import { MICRO_USD_PER_CREDIT } from "../../credits.ts"

const tokensPerMillion = 1_000_000

// DeepSeek V4 prices published per million tokens in August 2026.
// Source: https://api-docs.deepseek.com/quick_start/pricing/
const flashMicroUsdPerMillionTokens = {
  cacheHitInput: 2_800,
  cacheMissInput: 140_000,
  output: 280_000,
} as const

const proMicroUsdPerMillionTokens = {
  cacheHitInput: 3_625,
  cacheMissInput: 435_000,
  output: 870_000,
} as const

type DeepSeekV4Prices = {
  readonly cacheHitInput: number
  readonly cacheMissInput: number
  readonly output: number
}

function requireTokenCount(
  value: number | undefined,
  field: string,
  modelName: string,
): number {
  if (value === undefined) {
    throw new Error(`Cannot calculate ${modelName} cost without ${field}`)
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${modelName} ${field}: ${value}`)
  }
  return value
}

function calculateDeepSeekV4CostMicroUsd(
  usage: LanguageModelUsage,
  modelName: string,
  prices: DeepSeekV4Prices,
): number {
  const cacheHitInputTokens = requireTokenCount(
    usage.inputTokenDetails.cacheReadTokens,
    "cache-hit input token count",
    modelName,
  )
  const cacheMissInputTokens = requireTokenCount(
    usage.inputTokenDetails.noCacheTokens,
    "cache-miss input token count",
    modelName,
  )
  const outputTokens = requireTokenCount(
    usage.outputTokens,
    "output token count",
    modelName,
  )

  const weightedMicroUsd =
    cacheHitInputTokens * prices.cacheHitInput +
    cacheMissInputTokens * prices.cacheMissInput +
    outputTokens * prices.output

  if (!Number.isSafeInteger(weightedMicroUsd)) {
    throw new Error(`${modelName} cost exceeded safe integer precision`)
  }

  return Math.ceil(weightedMicroUsd / tokensPerMillion)
}

/** Calculates one DeepSeek V4 Flash generation's cost in integer micro-USD. */
export function calculateDeepSeekV4FlashCostMicroUsd(
  usage: LanguageModelUsage,
): number {
  return calculateDeepSeekV4CostMicroUsd(
    usage,
    "DeepSeek V4 Flash",
    flashMicroUsdPerMillionTokens,
  )
}

/** Converts actual provider usage to the product's $1 / 1,000-credit base. */
export function calculateDeepSeekV4FlashCredits(
  usage: LanguageModelUsage,
): number {
  // Product policy: round each successful generation independently to whole
  // credits; do not aggregate fractional costs across an entire run.
  return Math.ceil(
    calculateDeepSeekV4FlashCostMicroUsd(usage) / MICRO_USD_PER_CREDIT,
  )
}

/** Calculates one DeepSeek V4 Pro generation's cost in integer micro-USD. */
export function calculateDeepSeekV4ProCostMicroUsd(
  usage: LanguageModelUsage,
): number {
  return calculateDeepSeekV4CostMicroUsd(
    usage,
    "DeepSeek V4 Pro",
    proMicroUsdPerMillionTokens,
  )
}

/** Converts actual provider usage to the product's $1 / 1,000-credit base. */
export function calculateDeepSeekV4ProCredits(
  usage: LanguageModelUsage,
): number {
  return Math.ceil(
    calculateDeepSeekV4ProCostMicroUsd(usage) / MICRO_USD_PER_CREDIT,
  )
}
