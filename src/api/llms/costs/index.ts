import type { LanguageModelUsage } from "ai"

import type { LlmConfig } from "../../config.ts"
import { calculateDeepSeekV4FlashCredits } from "./deepseekV4Flash.ts"

export function calculateLlmCredits(
  llmConfig: LlmConfig,
  modelId: string,
  usage: LanguageModelUsage,
): number {
  if (
    llmConfig.provider === "deepseek" &&
    modelId === "deepseek-v4-flash"
  ) {
    return calculateDeepSeekV4FlashCredits(usage)
  }
  throw new Error(`No credit pricing function exists for ${modelId}`)
}
