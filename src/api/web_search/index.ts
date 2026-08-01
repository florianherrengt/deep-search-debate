import { searxng, type WebSearchResult } from "./searxng.ts"

export async function webSearch(params: {
  query: string
}): Promise<WebSearchResult[]> {
  return searxng(params)
}
