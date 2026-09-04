export type LlmFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other"

export type LlmUsage = {
  inputTokens: number | undefined
  inputTokenDetails: {
    noCacheTokens: number | undefined
    cacheReadTokens: number | undefined
    cacheWriteTokens: number | undefined
  }
  outputTokens: number | undefined
  outputTokenDetails: {
    textTokens: number | undefined
    reasoningTokens: number | undefined
  }
  totalTokens: number | undefined
}

export type LlmStreamPart =
  | { type: "reasoning-delta"; id?: string; text: string }
  | { type: "text-delta"; id?: string; text: string }
  | { type: "error"; error: unknown }

export type StartedLlmStream = {
  stream: AsyncIterable<LlmStreamPart>
  finishReason: PromiseLike<LlmFinishReason>
  rawFinishReason: PromiseLike<string | undefined>
  usage: PromiseLike<LlmUsage>
}
