import type { LanguageModelUsage } from "ai"

import type { LlmConfig } from "../../config.ts"
import { calculateDeepSeekV4FlashCredits } from "./deepseekV4Flash.ts"

export function calculateLlmCredits(
  llmConfig: LlmConfig,
  modelId: string,
  usage: LanguageModelUsage,
): number {
  // Zen is restricted to development, where its provider usage is deliberately
  // excluded from production product-credit accounting.
  if (llmConfig.provider === "zen") return 0

  if (modelId === "deepseek-v4-flash") {
    return calculateDeepSeekV4FlashCredits(usage)
  }
  throw new Error(`No credit pricing function exists for ${modelId}`)
}
