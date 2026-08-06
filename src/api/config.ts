import { isIP } from "node:net"
import z from "zod"

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost" || normalized === "::1") return true
  if (isIP(normalized) === 4) return normalized.split(".")[0] === "127"
  if (isIP(normalized) !== 6) return false

  return new URL(`http://[${normalized}]`).hostname === "[::1]"
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
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
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  AUTH_DEBUG_USER_ENABLED: z.stringbool().default(false),
  AUTH_DEBUG_USER_EMAIL: z.email().default("debug@local.invalid"),
  AUTH_DEBUG_USER_PASSWORD: z.string().min(12).optional(),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV === "production") {
    if (new URL(environment.BETTER_AUTH_URL).protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "BETTER_AUTH_URL must use HTTPS in production",
        path: ["BETTER_AUTH_URL"],
      })
    }
    const productionPlaceholders: [keyof typeof environment, string][] = [
      ["BETTER_AUTH_SECRET", environment.BETTER_AUTH_SECRET],
      ["GITHUB_CLIENT_ID", environment.GITHUB_CLIENT_ID],
      ["GITHUB_CLIENT_SECRET", environment.GITHUB_CLIENT_SECRET],
    ]
    for (const [key, value] of productionPlaceholders) {
      if (/^(replace-with-|change-me|test-)/i.test(value)) {
        context.addIssue({
          code: "custom",
          message: `${key} must not use a placeholder in production`,
          path: [key],
        })
      }
    }
  }
  if (
    environment.AUTH_DEBUG_USER_ENABLED &&
    environment.NODE_ENV === "production"
  ) {
    context.addIssue({
      code: "custom",
      message: "AUTH_DEBUG_USER_ENABLED cannot be enabled in production",
      path: ["AUTH_DEBUG_USER_ENABLED"],
    })
  }
  if (
    environment.AUTH_DEBUG_USER_ENABLED &&
    !isLoopbackHostname(environment.API_HOST)
  ) {
    context.addIssue({
      code: "custom",
      message: "API_HOST must be loopback when debug auth is enabled",
      path: ["API_HOST"],
    })
  }
  if (
    environment.AUTH_DEBUG_USER_ENABLED &&
    !isLoopbackHostname(new URL(environment.BETTER_AUTH_URL).hostname)
  ) {
    context.addIssue({
      code: "custom",
      message: "BETTER_AUTH_URL must be loopback when debug auth is enabled",
      path: ["BETTER_AUTH_URL"],
    })
  }
  if (
    environment.AUTH_DEBUG_USER_ENABLED &&
    environment.AUTH_DEBUG_USER_PASSWORD === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "AUTH_DEBUG_USER_PASSWORD is required when debug auth is enabled",
      path: ["AUTH_DEBUG_USER_PASSWORD"],
    })
  }
})

const environment = environmentSchema.parse(process.env)

export const config = {
  environment: environment.NODE_ENV,
  api: { hostname: environment.API_HOST, port: environment.PORT },
  db: { url: environment.DATABASE_URL },
  auth: {
    baseUrl: environment.BETTER_AUTH_URL,
    trustedOrigin: new URL(environment.BETTER_AUTH_URL).origin,
    secret: environment.BETTER_AUTH_SECRET,
    github: {
      clientId: environment.GITHUB_CLIENT_ID,
      clientSecret: environment.GITHUB_CLIENT_SECRET,
    },
    debugUser: {
      enabled: environment.AUTH_DEBUG_USER_ENABLED,
      email: environment.AUTH_DEBUG_USER_EMAIL,
      password: environment.AUTH_DEBUG_USER_PASSWORD,
    },
  },
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
