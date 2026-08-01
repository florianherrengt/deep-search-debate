import z from "zod"

const environmentSchema = z.object({
  SEARXNG_URL: z.url(),
  DEEPSEEK_API_KEY: z.string().min(1),
  SCRAPINGANT_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1).default("data.db"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
})

const environment = environmentSchema.parse(process.env)

export const config = {
  api: { port: environment.PORT },
  db: { url: environment.DATABASE_URL },
  webSearch: {
    searxng: { url: environment.SEARXNG_URL },
  },
  extraction: {
    scrapingant: { apiKey: environment.SCRAPINGANT_API_KEY },
  },
  llm: {
    deepseek: {
      apiKey: environment.DEEPSEEK_API_KEY,
      model: "deepseek-v4-flash",
    },
  },
}
