import { config } from "../config.ts"
import { requirePositiveCreditBalance } from "../credits.ts"
import { brave } from "./brave.ts"
import { searxng } from "./searxng.ts"
import type { WebSearchResult } from "./types.ts"

const providers = { brave, searxng }

export async function webSearch(params: {
  userId: string
  query: string
  signal?: AbortSignal
}): Promise<{ results: WebSearchResult[]; creditsUsed: number }> {
  requirePositiveCreditBalance(params.userId)
  const deadline = AbortSignal.timeout(config.webSearch.timeoutMs)
  const signal = params.signal
    ? AbortSignal.any([params.signal, deadline])
    : deadline
  const results = await providers[config.webSearch.provider]({
    query: params.query,
    signal,
  })
  return { results, creditsUsed: config.webSearch.creditsPerRequest }
}

export type { WebSearchResult } from "./types.ts"
