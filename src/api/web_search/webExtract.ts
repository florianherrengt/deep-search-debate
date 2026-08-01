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
import z from "zod"
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

const webExtractResultSchema = z.object({
  url: z.string(),
  content: z.string(),
})

export const webExtract = z
  .function()
  .input(z.tuple([z.object({ url: z.string().url() })]))
  .output(webExtractResultSchema)
  .implementAsync(async (params) => {
    const result = await extractPage(params.url, undefined, extractDeps)
    return { url: result.url, content: result.content }
  })
