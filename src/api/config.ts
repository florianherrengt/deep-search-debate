import { isIP } from "node:net"
import z from "zod"
import { resolveRuntimeDefaults } from "./runtimeDefaults.ts"

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost" || normalized === "::1") return true
  if (isIP(normalized) === 4) return normalized.split(".")[0] === "127"
  if (isIP(normalized) !== 6) return false

  return new URL(`http://[${normalized}]`).hostname === "[::1]"
}

const nonWhitespaceSecretSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "Secret must not be empty or whitespace-only",
)

const secretSchemas = {
  BRAVE_SEARCH_API_KEY: nonWhitespaceSecretSchema,
  DEEPSEEK_API_KEY: nonWhitespaceSecretSchema,
  SCRAPINGANT_API_KEY: nonWhitespaceSecretSchema,
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine(
      (value) => value.trim().length > 0,
      "Secret must not be empty or whitespace-only",
    ),
  GITHUB_CLIENT_ID: nonWhitespaceSecretSchema,
  GITHUB_CLIENT_SECRET: nonWhitespaceSecretSchema,
  AUTH_DEBUG_USER_PASSWORD: z
    .string()
    .min(12)
    .refine(
      (value) => value.trim().length > 0,
      "Secret must not be empty or whitespace-only",
    ),
} as const

const nonSecretEnvironmentShape = {
  NODE_ENV: z.enum(["development", "test", "production"]),
  SEARXNG_URL: z.url().optional(),
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
  DATABASE_URL: z.string().min(1).optional(),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  BETTER_AUTH_URL: z.url().optional(),
  AUTH_DEBUG_USER_ENABLED: z.stringbool().default(false),
  AUTH_DEBUG_USER_EMAIL: z.email().default("debug@local.invalid"),
} as const

const rawEnvironmentSchema = z.object({
  ...nonSecretEnvironmentShape,
  BRAVE_SEARCH_API_KEY: secretSchemas.BRAVE_SEARCH_API_KEY.optional(),
  DEEPSEEK_API_KEY: secretSchemas.DEEPSEEK_API_KEY,
  SCRAPINGANT_API_KEY: secretSchemas.SCRAPINGANT_API_KEY,
  BETTER_AUTH_SECRET: secretSchemas.BETTER_AUTH_SECRET,
  GITHUB_CLIENT_ID: secretSchemas.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: secretSchemas.GITHUB_CLIENT_SECRET,
  AUTH_DEBUG_USER_PASSWORD:
    secretSchemas.AUTH_DEBUG_USER_PASSWORD.optional(),
})

const environmentSchema = z.object({
  ...nonSecretEnvironmentShape,
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  AUTH_DEBUG_USER_ENABLED: z.boolean(),
  BRAVE_SEARCH_API_KEY: secretSchemas.BRAVE_SEARCH_API_KEY.optional(),
  DEEPSEEK_API_KEY: secretSchemas.DEEPSEEK_API_KEY,
  SCRAPINGANT_API_KEY: secretSchemas.SCRAPINGANT_API_KEY,
  BETTER_AUTH_SECRET: secretSchemas.BETTER_AUTH_SECRET,
  GITHUB_CLIENT_ID: secretSchemas.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: secretSchemas.GITHUB_CLIENT_SECRET,
  AUTH_DEBUG_USER_PASSWORD:
    secretSchemas.AUTH_DEBUG_USER_PASSWORD.optional(),
}).superRefine((environment, context) => {
  if (
    environment.NODE_ENV === "production" &&
    environment.BRAVE_SEARCH_API_KEY === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "BRAVE_SEARCH_API_KEY is required in production",
      path: ["BRAVE_SEARCH_API_KEY"],
    })
  }
  if (
    environment.NODE_ENV !== "production" &&
    environment.SEARXNG_URL === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "SEARXNG_URL is required outside production",
      path: ["SEARXNG_URL"],
    })
  }
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

const rawEnvironment = rawEnvironmentSchema.parse(process.env)
const environmentDefaults = resolveRuntimeDefaults(rawEnvironment.NODE_ENV)

const environment = environmentSchema.parse({
  ...rawEnvironment,
  DATABASE_URL: rawEnvironment.DATABASE_URL ?? environmentDefaults.databaseUrl,
  BETTER_AUTH_URL:
    rawEnvironment.BETTER_AUTH_URL ?? environmentDefaults.betterAuthUrl,
})

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
    provider:
      environment.NODE_ENV === "production"
        ? ("brave" as const)
        : ("searxng" as const),
    brave: { apiKey: environment.BRAVE_SEARCH_API_KEY },
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
