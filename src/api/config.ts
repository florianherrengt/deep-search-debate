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

const optionalSecretSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  nonWhitespaceSecretSchema.optional(),
)

const exampleDebateIdsSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === "") return []
    if (typeof value !== "string") return value
    return [
      ...new Set(
        value
          .split(",")
          .map((debateJobId) => debateJobId.trim().toLowerCase())
          .filter(Boolean),
      ),
    ]
  },
  z.array(z.uuid()).max(50),
)

const secretSchemas = {
  BRAVE_SEARCH_API_KEY: nonWhitespaceSecretSchema,
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
  LLM_PROVIDER: z.enum(["deepseek", "zen"]),
  LLM_MODEL_NAME: z.string().trim().min(1),
  LLM_GENERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(900_000)
    .default(300_000),
  LLM_FIRST_CHUNK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(120_000),
  LLM_CHUNK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(60_000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(65_536)
    .default(8_192),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_MAX_CONCURRENT_GENERATIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(4),
  LLM_MAX_ACTIVE_STANDALONE_GENERATIONS_PER_USER: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
  RESEARCH_JOB_CREATION_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(604_800_000)
    .default(86_400_000),
  RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5),
  DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(4),
  IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(2),
  DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1),
  SEARXNG_URL: z.url().optional(),
  SEARXNG_CATEGORIES: z
    .string()
    .trim()
    .regex(/^[a-z0-9 -]+(?:\s*,\s*[a-z0-9 -]+)*$/i)
    .default("general,science"),
  SEARXNG_MAX_CONCURRENT_REQUESTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1),
  SEARXNG_MIN_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(1_000),
  WEB_SEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  WEB_SEARCH_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(10_000_000)
    .default(2_000_000),
  WEB_SEARCH_CREDITS_COST: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(1),
  SCRAPINGANT_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(65_000)
    .default(35_000),
  SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(600_000)
    .default(120_000),
  SCRAPINGANT_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(10_000_000)
    .default(2_000_000),
  DEEP_SEARCH_MAX_SEARCHES: z.coerce
    .number()
    .int()
    .min(3)
    .max(25)
    .default(5),
  DEEP_SEARCH_MAX_RESULTS_PER_SEARCH: z.coerce
    .number()
    .int()
    .min(3)
    .max(20)
    .default(5),
  DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND: z.coerce
    .number()
    .int()
    .min(9)
    .max(100)
    .default(15),
  DEEP_SEARCH_MAX_ROUNDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(2),
  DEEP_SEARCH_MAX_REQUEST_CHARS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(50_000)
    .default(10_000),
  DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS: z.coerce
    .number()
    .int()
    .min(25_000)
    .max(200_000)
    .default(100_000),
  DEEP_SEARCH_MAX_CONCURRENT_JOBS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
  DEEP_SEARCH_MAX_CONCURRENT_PAGE_TASKS: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(4),
  RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
  RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB: z.coerce
    .number()
    .int()
    .min(50)
    .max(2_000)
    .default(200),
  IDEA_JOB_MAX_IDEA_COUNT: z.coerce
    .number()
    .int()
    .min(6)
    .max(20)
    .default(12),
  IDEA_JOB_MAX_DEEP_SEARCH_COUNT: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
  DEBATE_MAX_IDEA_COUNT: z.coerce
    .number()
    .int()
    .min(6)
    .max(12)
    .refine((value) => value % 2 === 0, "Debate idea limit must be even")
    .default(8),
  DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1),
  DEBATE_MAX_SEARCHES_PER_CHILD: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3),
  DEBATE_MAX_RESULTS_PER_SEARCH: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3),
  DEBATE_MAX_RESEARCH_ROUNDS_PER_CHILD: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .default(1),
  DEBATE_MAX_SELECTED_PAGES_PER_JOB: z.coerce
    .number()
    .int()
    .min(20)
    .max(500)
    .default(81),
  DATABASE_URL: z.string().min(1).optional(),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  BETTER_AUTH_URL: z.url().optional(),
  AUTH_DEBUG_USER_ENABLED: z.stringbool().default(false),
  AUTH_DEBUG_USER_EMAIL: z.email().default("debug@local.invalid"),
  EXAMPLE_DEBATE_IDS: exampleDebateIdsSchema,
} as const

const rawEnvironmentSchema = z.object({
  ...nonSecretEnvironmentShape,
  BRAVE_SEARCH_API_KEY: secretSchemas.BRAVE_SEARCH_API_KEY.optional(),
  DEEPSEEK_API_KEY: optionalSecretSchema,
  OPENCODE_ZEN_API_KEY: optionalSecretSchema,
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
  DEEPSEEK_API_KEY: optionalSecretSchema,
  OPENCODE_ZEN_API_KEY: optionalSecretSchema,
  SCRAPINGANT_API_KEY: secretSchemas.SCRAPINGANT_API_KEY,
  BETTER_AUTH_SECRET: secretSchemas.BETTER_AUTH_SECRET,
  GITHUB_CLIENT_ID: secretSchemas.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: secretSchemas.GITHUB_CLIENT_SECRET,
  AUTH_DEBUG_USER_PASSWORD:
    secretSchemas.AUTH_DEBUG_USER_PASSWORD.optional(),
}).superRefine((environment, context) => {
  if (
    environment.LLM_FIRST_CHUNK_TIMEOUT_MS >
    environment.LLM_GENERATION_TIMEOUT_MS
  ) {
    context.addIssue({
      code: "custom",
      message:
        "LLM_FIRST_CHUNK_TIMEOUT_MS cannot exceed LLM_GENERATION_TIMEOUT_MS",
      path: ["LLM_FIRST_CHUNK_TIMEOUT_MS"],
    })
  }
  if (
    environment.LLM_CHUNK_TIMEOUT_MS >
    environment.LLM_GENERATION_TIMEOUT_MS
  ) {
    context.addIssue({
      code: "custom",
      message: "LLM_CHUNK_TIMEOUT_MS cannot exceed LLM_GENERATION_TIMEOUT_MS",
      path: ["LLM_CHUNK_TIMEOUT_MS"],
    })
  }
  const rootCreationLimit =
    environment.RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW
  for (const key of [
    "DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
    "IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
    "DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
  ] as const) {
    if (environment[key] > rootCreationLimit) {
      context.addIssue({
        code: "custom",
        message: `${key} cannot exceed RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW`,
        path: [key],
      })
    }
  }
  if (environment.DEBATE_MAX_IDEA_COUNT > environment.IDEA_JOB_MAX_IDEA_COUNT) {
    context.addIssue({
      code: "custom",
      message: "DEBATE_MAX_IDEA_COUNT cannot exceed IDEA_JOB_MAX_IDEA_COUNT",
      path: ["DEBATE_MAX_IDEA_COUNT"],
    })
  }
  if (
    environment.DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT >
    environment.IDEA_JOB_MAX_DEEP_SEARCH_COUNT
  ) {
    context.addIssue({
      code: "custom",
      message:
        "DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT cannot exceed IDEA_JOB_MAX_DEEP_SEARCH_COUNT",
      path: ["DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT"],
    })
  }
  for (const [debateKey, deepSearchKey] of [
    ["DEBATE_MAX_SEARCHES_PER_CHILD", "DEEP_SEARCH_MAX_SEARCHES"],
    ["DEBATE_MAX_RESULTS_PER_SEARCH", "DEEP_SEARCH_MAX_RESULTS_PER_SEARCH"],
    ["DEBATE_MAX_RESEARCH_ROUNDS_PER_CHILD", "DEEP_SEARCH_MAX_ROUNDS"],
  ] as const) {
    if (environment[debateKey] > environment[deepSearchKey]) {
      context.addIssue({
        code: "custom",
        message: `${debateKey} cannot exceed ${deepSearchKey}`,
        path: [debateKey],
      })
    }
  }
  if (
    environment.DEBATE_MAX_SELECTED_PAGES_PER_JOB >
    environment.RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB
  ) {
    context.addIssue({
      code: "custom",
      message:
        "DEBATE_MAX_SELECTED_PAGES_PER_JOB cannot exceed RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB",
      path: ["DEBATE_MAX_SELECTED_PAGES_PER_JOB"],
    })
  }
  if (
    environment.LLM_PROVIDER === "deepseek" &&
    environment.DEEPSEEK_API_KEY === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek",
      path: ["DEEPSEEK_API_KEY"],
    })
  }
  if (
    environment.LLM_PROVIDER === "deepseek" &&
    environment.LLM_MODEL_NAME !== "deepseek-v4-flash"
  ) {
    context.addIssue({
      code: "custom",
      message:
        "LLM_MODEL_NAME must be deepseek-v4-flash when LLM_PROVIDER=deepseek",
      path: ["LLM_MODEL_NAME"],
    })
  }
  if (
    environment.LLM_PROVIDER === "zen" &&
    environment.NODE_ENV !== "development"
  ) {
    context.addIssue({
      code: "custom",
      message: "LLM_PROVIDER=zen is available only in development",
      path: ["LLM_PROVIDER"],
    })
  }
  if (
    environment.LLM_PROVIDER === "zen" &&
    environment.OPENCODE_ZEN_API_KEY === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "OPENCODE_ZEN_API_KEY is required when LLM_PROVIDER=zen",
      path: ["OPENCODE_ZEN_API_KEY"],
    })
  }
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

export type LlmConfig =
  | {
      provider: "deepseek"
      model: string
      apiKey: string
    }
  | {
      provider: "zen"
      model: string
      apiKey: string
      baseUrl: string
    }

function resolveLlmConfig(): LlmConfig {
  if (environment.LLM_PROVIDER === "deepseek") {
    if (environment.DEEPSEEK_API_KEY === undefined) {
      throw new Error("Validated DeepSeek API key is missing")
    }
    return {
      provider: "deepseek",
      model: environment.LLM_MODEL_NAME,
      apiKey: environment.DEEPSEEK_API_KEY,
    }
  }

  if (environment.OPENCODE_ZEN_API_KEY === undefined) {
    throw new Error("Validated OpenCode Zen API key is missing")
  }
  return {
    provider: "zen",
    model: environment.LLM_MODEL_NAME,
    apiKey: environment.OPENCODE_ZEN_API_KEY,
    baseUrl: "https://opencode.ai/zen/v1",
  }
}

export const config = {
  environment: environment.NODE_ENV,
  api: { hostname: environment.API_HOST, port: environment.PORT },
  web: { publicBaseUrl: environment.BETTER_AUTH_URL },
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
  abuseProtection: {
    researchJobCreationWindowMs:
      environment.RESEARCH_JOB_CREATION_WINDOW_MS,
    maxRootJobCreationsPerWindow:
      environment.RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW,
    maxDeepSearchCreationsPerWindow:
      environment.DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW,
    maxIdeaJobCreationsPerWindow:
      environment.IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW,
    maxDebateCreationsPerWindow:
      environment.DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW,
  },
  webSearch: {
    // TODO: Replace the temporary production Brave integration with Serper.
    provider:
      environment.NODE_ENV === "production"
        ? ("brave" as const)
        : ("searxng" as const),
    brave: { apiKey: environment.BRAVE_SEARCH_API_KEY },
    searxng: {
      url: environment.SEARXNG_URL,
      categories: [
        ...new Set(
          environment.SEARXNG_CATEGORIES.split(",").map((category) =>
            category.trim(),
          ),
        ),
      ],
      maxConcurrentRequests: environment.SEARXNG_MAX_CONCURRENT_REQUESTS,
      minIntervalMs: environment.SEARXNG_MIN_INTERVAL_MS,
    },
    timeoutMs: environment.WEB_SEARCH_TIMEOUT_MS,
    maxResponseBytes: environment.WEB_SEARCH_MAX_RESPONSE_BYTES,
    creditsPerRequest: environment.WEB_SEARCH_CREDITS_COST,
  },
  extraction: {
    scrapingant: {
      apiKey: environment.SCRAPINGANT_API_KEY,
      queueWaitTimeoutMs: environment.SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS,
      requestTimeoutMs: environment.SCRAPINGANT_REQUEST_TIMEOUT_MS,
      maxResponseBytes: environment.SCRAPINGANT_MAX_RESPONSE_BYTES,
    },
  },
  deepSearch: {
    maxSearches: environment.DEEP_SEARCH_MAX_SEARCHES,
    maxResultsPerSearch: environment.DEEP_SEARCH_MAX_RESULTS_PER_SEARCH,
    maxSelectedUrlsPerRound:
      environment.DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND,
    maxRounds: environment.DEEP_SEARCH_MAX_ROUNDS,
    maxRequestChars: environment.DEEP_SEARCH_MAX_REQUEST_CHARS,
    maxSummaryContextChars: environment.DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS,
    maxConcurrentJobs: environment.DEEP_SEARCH_MAX_CONCURRENT_JOBS,
    maxConcurrentPageTasks:
      environment.DEEP_SEARCH_MAX_CONCURRENT_PAGE_TASKS,
    maxActiveRootJobsPerUser:
      environment.RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER,
    maxSelectedPagesPerRootJob:
      environment.RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB,
    maxInitialIdeaSearches: environment.IDEA_JOB_MAX_DEEP_SEARCH_COUNT,
    maxIdeaCount: environment.IDEA_JOB_MAX_IDEA_COUNT,
  },
  debate: {
    maxIdeaCount: environment.DEBATE_MAX_IDEA_COUNT,
    maxInitialDeepSearches:
      environment.DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT,
    maxSearchesPerChild: environment.DEBATE_MAX_SEARCHES_PER_CHILD,
    maxResultsPerSearch: environment.DEBATE_MAX_RESULTS_PER_SEARCH,
    maxResearchRoundsPerChild:
      environment.DEBATE_MAX_RESEARCH_ROUNDS_PER_CHILD,
    maxSelectedPagesPerJob:
      environment.DEBATE_MAX_SELECTED_PAGES_PER_JOB,
  },
  examples: { debateIds: environment.EXAMPLE_DEBATE_IDS },
  llm: resolveLlmConfig(),
  llmExecution: {
    totalTimeoutMs: environment.LLM_GENERATION_TIMEOUT_MS,
    firstChunkTimeoutMs: environment.LLM_FIRST_CHUNK_TIMEOUT_MS,
    chunkTimeoutMs: environment.LLM_CHUNK_TIMEOUT_MS,
    maxOutputTokens: environment.LLM_MAX_OUTPUT_TOKENS,
    maxRetries: environment.LLM_MAX_RETRIES,
    maxConcurrentGenerations: environment.LLM_MAX_CONCURRENT_GENERATIONS,
    maxActiveStandaloneGenerationsPerUser:
      environment.LLM_MAX_ACTIVE_STANDALONE_GENERATIONS_PER_USER,
  },
}
