import type { LanguageModelUsage } from "ai"

import type { LlmConfig } from "../../config.ts"
import {
  calculateDeepSeekV4FlashCredits,
  calculateDeepSeekV4ProCredits,
} from "./deepseekV4Flash.ts"

export function calculateLlmCredits(
  llmConfig: LlmConfig,
  modelId: string,
  usage: LanguageModelUsage,
): number {
  // Zen's upstream model is free in development, but each successful generation
  // still costs one credit for use of the RethinkLoop product.
  if (llmConfig.provider === "zen") return 1

  if (modelId === "deepseek-v4-flash") {
    return calculateDeepSeekV4FlashCredits(usage)
  }
  if (modelId === "deepseek-v4-pro") {
    return calculateDeepSeekV4ProCredits(usage)
  }
  throw new Error(`No credit pricing function exists for ${modelId}`)
}
