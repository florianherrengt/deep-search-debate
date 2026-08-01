import {
  AmazonExtractor,
  createScrapingAntPageLoader,
  extractPage,
  GithubExtractor,
  HackerNewsExtractor,
  RedditExtractor,
  ShopifyExtractor,
  TrustpilotExtractor,
  YouTubeExtractor,
  type ExtractPageDeps,
} from "deep-search-core/search-extract"
import { config } from "../config.ts"

const pageLoader = createScrapingAntPageLoader({
  apiKey: config.extraction.scrapingant.apiKey,
  fetch: globalThis.fetch,
})

export const extractDeps: ExtractPageDeps = {
  fetch: globalThis.fetch,
  pageLoader,
  extractors: [
    new RedditExtractor(),
    new AmazonExtractor(),
    new ShopifyExtractor(),
    new TrustpilotExtractor(),
    new GithubExtractor(),
    new YouTubeExtractor(),
    new HackerNewsExtractor(),
  ],
}

export async function webExtract(params: {
  url: string
}): Promise<{ url: string; content: string }> {
  const result = await extractPage(params.url, undefined, extractDeps)
  return { url: result.url, content: result.content }
}
