import z from "zod"

const environmentSchema = z.object({
  SEARXNG_URL: z.url(),
  DEEPSEEK_API_KEY: z.string().min(1),
  SCRAPINGANT_API_KEY: z.string().min(1),
  SCRAPINGANT_PROXY_TYPE: z
    .enum(["datacenter", "residential"])
    .default("datacenter"),
  SCRAPINGANT_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  SCRAPINGANT_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(1_000),
  DATABASE_URL: z.string().min(1).default("data.db"),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
})

const environment = environmentSchema.parse(process.env)

export const config = {
  api: { hostname: environment.API_HOST, port: environment.PORT },
  db: { url: environment.DATABASE_URL },
  webSearch: {
    searxng: { url: environment.SEARXNG_URL },
  },
  extraction: {
    scrapingant: {
      apiKey: environment.SCRAPINGANT_API_KEY,
      proxyType: environment.SCRAPINGANT_PROXY_TYPE,
      maxRetries: environment.SCRAPINGANT_MAX_RETRIES,
      retryDelayMs: environment.SCRAPINGANT_RETRY_DELAY_MS,
    },
  },
  llm: {
    deepseek: {
      apiKey: environment.DEEPSEEK_API_KEY,
      model: "deepseek-v4-flash",
    },
  },
}
