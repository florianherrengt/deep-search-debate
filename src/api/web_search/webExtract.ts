import { extractPage } from "deep-search-core/search-extract"
import z from "zod"

const webExtractResultSchema = z.object({
  url: z.string(),
  content: z.string(),
})

export const webExtract = z
  .function()
  .input(z.tuple([z.object({ url: z.string().url() })]))
  .output(webExtractResultSchema)
  .implementAsync(async (params) => {
    const result = await extractPage(params.url, undefined, {
      fetch: globalThis.fetch,
    })
    return { url: result.url, content: result.content }
  })
