import { setTimeout as delay } from "node:timers/promises"
import {
  AmazonExtractor,
  createScrapingAntPageLoader,
  extractPage,
  GithubExtractor,
  HackerNewsExtractor,
  PdfExtractor,
  RedditExtractor,
  ShopifyExtractor,
  TrustpilotExtractor,
  YouTubeExtractor,
  type ExtractPageDeps,
  type PageLoader,
  type PageRenderOptions,
} from "deep-search-core/search-extract"
import { config } from "../config.ts"

const scrapingAntDetectionError = "ScrapingAnt request failed with HTTP 423"

async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  if (delayMs > 0) await delay(delayMs, undefined, { signal })
}

async function renderWithRetries(
  renderHtml: NonNullable<PageLoader["renderHtml"]>,
  url: string,
  options: PageRenderOptions,
): Promise<string | null> {
  const { maxRetries, retryDelayMs } = config.extraction.scrapingant

  for (let retry = 0; ; retry += 1) {
    try {
      return await renderHtml(url, options)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== scrapingAntDetectionError ||
        retry >= maxRetries
      ) {
        throw error
      }
      await waitForRetry(retryDelayMs * 2 ** retry, options.signal)
    }
  }
}

function serializePageRenders(pageLoader: PageLoader): PageLoader {
  const renderHtml = pageLoader.renderHtml
  if (!renderHtml) return pageLoader

  let renderQueue = Promise.resolve()

  return {
    ...pageLoader,
    renderHtml(url, options) {
      const result = renderQueue.then(() =>
        renderWithRetries(renderHtml, url, options),
      )
      renderQueue = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  }
}

const pageLoader = serializePageRenders(
  createScrapingAntPageLoader({
    apiKey: config.extraction.scrapingant.apiKey,
    fetch: globalThis.fetch,
    params: { proxy_type: config.extraction.scrapingant.proxyType },
  }),
)

export const extractDeps: ExtractPageDeps = {
  fetch: globalThis.fetch,
  pageLoader,
  extractors: [
    new PdfExtractor(),
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
