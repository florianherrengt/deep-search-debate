import { config } from "../config.ts"
import { brave } from "./brave.ts"
import { searxng } from "./searxng.ts"
import type { WebSearchResult } from "./types.ts"

const providers = { brave, searxng }

export async function webSearch(params: {
  query: string
  signal?: AbortSignal
}): Promise<WebSearchResult[]> {
  const deadline = AbortSignal.timeout(config.webSearch.timeoutMs)
  const signal = params.signal
    ? AbortSignal.any([params.signal, deadline])
    : deadline
  return providers[config.webSearch.provider]({ ...params, signal })
}

export type { WebSearchResult } from "./types.ts"
