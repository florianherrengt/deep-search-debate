import { config } from "../config.ts"
import { brave } from "./brave.ts"
import { searxng } from "./searxng.ts"
import type { WebSearchResult } from "./types.ts"

const providers = { brave, searxng }

export async function webSearch(params: {
  query: string
}): Promise<WebSearchResult[]> {
  return providers[config.webSearch.provider](params)
}

export type { WebSearchResult } from "./types.ts"
