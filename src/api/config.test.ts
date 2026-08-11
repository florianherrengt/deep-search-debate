import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("config", () => {
  it("requires an explicit runtime environment", async () => {
    const configuredEnvironment = process.env.NODE_ENV
    delete process.env.NODE_ENV
    vi.resetModules()

    try {
      await expect(import("./config.ts")).rejects.toThrow("NODE_ENV")
    } finally {
      if (configuredEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = configuredEnvironment
      vi.resetModules()
    }
  })

  it("keeps the development API private when API_HOST is unset", async () => {
    const configuredHost = process.env.API_HOST
    delete process.env.API_HOST
    vi.resetModules()

    try {
      const { config } = await import("./config.ts")
      expect(config.api.hostname).toBe("127.0.0.1")
    } finally {
      if (configuredHost === undefined) delete process.env.API_HOST
      else process.env.API_HOST = configuredHost
      vi.resetModules()
    }
  })

  it("uses the configured API port", async () => {
    vi.stubEnv("PORT", "4321")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.api.port).toBe(4321)
  })

  it("uses typed deep-search concurrency limits", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_CONCURRENT_JOBS", "3")
    vi.stubEnv("DEEP_SEARCH_MAX_CONCURRENT_PAGE_TASKS", "5")
    vi.stubEnv("RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER", "4")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.deepSearch).toMatchObject({
      maxConcurrentJobs: 3,
      maxConcurrentPageTasks: 5,
      maxActiveRootJobsPerUser: 4,
    })
  })

  it("uses a typed accumulated-summary context limit", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS", "75000")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.deepSearch.maxSummaryContextChars).toBe(75_000)
  })

  it("uses typed provider deadlines and standalone generation admission", async () => {
    vi.stubEnv("LLM_GENERATION_TIMEOUT_MS", "240000")
    vi.stubEnv("LLM_FIRST_CHUNK_TIMEOUT_MS", "90000")
    vi.stubEnv("LLM_CHUNK_TIMEOUT_MS", "45000")
    vi.stubEnv("LLM_MAX_OUTPUT_TOKENS", "12000")
    vi.stubEnv("LLM_MAX_RETRIES", "4")
    vi.stubEnv("LLM_MAX_CONCURRENT_GENERATIONS", "5")
    vi.stubEnv("LLM_MAX_ACTIVE_STANDALONE_GENERATIONS_PER_USER", "3")
    vi.stubEnv("WEB_SEARCH_TIMEOUT_MS", "25000")
    vi.stubEnv("WEB_SEARCH_MAX_RESPONSE_BYTES", "1500000")
    vi.stubEnv("SEARXNG_CATEGORIES", "general, science,science")
    vi.stubEnv("SEARXNG_MAX_CONCURRENT_REQUESTS", "2")
    vi.stubEnv("SEARXNG_MIN_INTERVAL_MS", "750")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llmExecution).toEqual({
      totalTimeoutMs: 240_000,
      firstChunkTimeoutMs: 90_000,
      chunkTimeoutMs: 45_000,
      maxOutputTokens: 12_000,
      maxRetries: 4,
      maxConcurrentGenerations: 5,
      maxActiveStandaloneGenerationsPerUser: 3,
    })
    expect(config.webSearch.timeoutMs).toBe(25_000)
    expect(config.webSearch.maxResponseBytes).toBe(1_500_000)
    expect(config.webSearch.searxng).toMatchObject({
      categories: ["general", "science"],
      maxConcurrentRequests: 2,
      minIntervalMs: 750,
    })
  })

  it("rejects invalid deep-search concurrency limits", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_CONCURRENT_JOBS", "0")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "DEEP_SEARCH_MAX_CONCURRENT_JOBS",
    )
  })

  it("keeps omitted request defaults within a lower configured round ceiling", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_ROUNDS", "1")
    vi.resetModules()

    const { deepSearchExecutionInputSchema } = await import(
      "./routes/deepSearch/resourceLimits.ts"
    )

    expect(
      deepSearchExecutionInputSchema.parse({ researchRequest: "Research this" }),
    ).toMatchObject({ maxRounds: 1 })
  })

  it("derives development URLs and paths from NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("BETTER_AUTH_URL", undefined)
    vi.stubEnv("DATABASE_URL", undefined)
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.baseUrl).toBe("http://localhost:5173")
    expect(config.db.url).toBe("data.db")
  })

  it("derives production URLs and paths from NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BETTER_AUTH_URL", undefined)
    vi.stubEnv("DATABASE_URL", undefined)
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "production-secret-with-at-least-32-characters",
    )
    vi.stubEnv("GITHUB_CLIENT_ID", "production-github-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "production-github-client-secret")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.baseUrl).toBe("https://rethinkloop.com")
    expect(config.db.url).toBe("/app/data/data.db")
  })

  it("rejects debug auth in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "true")
    vi.stubEnv("AUTH_DEBUG_USER_PASSWORD", "test-debug-password")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "AUTH_DEBUG_USER_ENABLED cannot be enabled in production",
    )
  })

  it("rejects debug auth on a public API binding", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("API_HOST", "0.0.0.0")
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:5173")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "true")
    vi.stubEnv("AUTH_DEBUG_USER_PASSWORD", "test-debug-password")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "API_HOST must be loopback when debug auth is enabled",
    )
  })

  it("rejects debug auth behind a public application origin", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("API_HOST", "127.0.0.1")
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "true")
    vi.stubEnv("AUTH_DEBUG_USER_PASSWORD", "test-debug-password")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "BETTER_AUTH_URL must be loopback when debug auth is enabled",
    )
  })

  it("rejects public auth placeholders in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "replace-with-at-least-32-random-characters",
    )
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "BETTER_AUTH_SECRET must not use a placeholder in production",
    )
  })

  it("requires an HTTPS auth origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BETTER_AUTH_URL", "http://app.example.com")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "BETTER_AUTH_URL must use HTTPS in production",
    )
  })

  it("uses Brave without SearXNG in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SEARXNG_URL", undefined)
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "production-brave-key")
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com")
    vi.stubEnv("BETTER_AUTH_SECRET", "production-secret-with-at-least-32-characters")
    vi.stubEnv("GITHUB_CLIENT_ID", "production-github-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "production-github-client-secret")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.webSearch.provider).toBe("brave")
    expect(config.webSearch.brave.apiKey).toBe("production-brave-key")
  })

  it("requires a Brave API key in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "")
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com")
    vi.stubEnv("BETTER_AUTH_SECRET", "production-secret-with-at-least-32-characters")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "BRAVE_SEARCH_API_KEY",
    )
  })

  it("requires the DeepSeek API key environment variable", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek")
    vi.stubEnv("DEEPSEEK_API_KEY", undefined)
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("DEEPSEEK_API_KEY")
  })

  it("requires an explicit LLM provider", async () => {
    vi.stubEnv("LLM_PROVIDER", undefined)
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("LLM_PROVIDER")
  })

  it("rejects an unsupported LLM provider", async () => {
    vi.stubEnv("LLM_PROVIDER", "unsupported")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("LLM_PROVIDER")
  })

  it("requires an explicit LLM model", async () => {
    vi.stubEnv("LLM_MODEL_NAME", undefined)
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("LLM_MODEL_NAME")
  })

  it("rejects a blank LLM model", async () => {
    vi.stubEnv("LLM_MODEL_NAME", "   ")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("LLM_MODEL_NAME")
  })

  it("selects OpenCode Zen without requiring a DeepSeek key", async () => {
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("LLM_MODEL_NAME", "deepseek-v4-flash-free")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", "environment-zen-key")
    vi.stubEnv("DEEPSEEK_API_KEY", undefined)
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm).toEqual({
      provider: "zen",
      model: "deepseek-v4-flash-free",
      apiKey: "environment-zen-key",
      baseUrl: "https://opencode.ai/zen/v1",
    })
  })

  it("requires the OpenCode Zen key only when Zen is selected", async () => {
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", " ")
    vi.stubEnv("DEEPSEEK_API_KEY", "unused-deepseek-key")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "OPENCODE_ZEN_API_KEY",
    )
  })

  it("allows an unselected provider key to be blank", async () => {
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", "environment-zen-key")
    vi.stubEnv("DEEPSEEK_API_KEY", "   ")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm.provider).toBe("zen")
  })

  it("requires the GitHub client ID environment variable", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", undefined)
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("GITHUB_CLIENT_ID")
  })

  it("uses a nonblank GitHub client ID environment variable", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "environment-github-client-id")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.github.clientId).toBe("environment-github-client-id")
  })

  it("uses a nonblank environment secret", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek")
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-deepseek-key")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "environment-deepseek-key",
    })
  })

  it("rejects a blank environment secret", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek")
    vi.stubEnv("DEEPSEEK_API_KEY", "   ")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("DEEPSEEK_API_KEY")
  })

  it("uses bounded ScrapingAnt retrieval defaults", async () => {
    vi.stubEnv("SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS", undefined)
    vi.stubEnv("SCRAPINGANT_REQUEST_TIMEOUT_MS", undefined)
    vi.stubEnv("SCRAPINGANT_MAX_RESPONSE_BYTES", undefined)
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.extraction.scrapingant).toMatchObject({
      queueWaitTimeoutMs: 120_000,
      requestTimeoutMs: 35_000,
      maxResponseBytes: 2_000_000,
    })
  })

  it("rejects an unbounded ScrapingAnt response limit", async () => {
    vi.stubEnv("SCRAPINGANT_MAX_RESPONSE_BYTES", "10000001")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "SCRAPINGANT_MAX_RESPONSE_BYTES",
    )
  })

  it("rejects an unbounded ScrapingAnt queue wait", async () => {
    vi.stubEnv("SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS", "600001")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "SCRAPINGANT_QUEUE_WAIT_TIMEOUT_MS",
    )
  })

  it("uses bounded deep-search defaults", async () => {
    for (const name of [
      "DEEP_SEARCH_MAX_SEARCHES",
      "DEEP_SEARCH_MAX_RESULTS_PER_SEARCH",
      "DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND",
      "DEEP_SEARCH_MAX_ROUNDS",
      "DEEP_SEARCH_MAX_REQUEST_CHARS",
      "DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS",
      "DEEP_SEARCH_MAX_CONCURRENT_JOBS",
      "DEEP_SEARCH_MAX_CONCURRENT_PAGE_TASKS",
      "RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER",
      "RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB",
      "IDEA_JOB_MAX_DEEP_SEARCH_COUNT",
    ]) {
      vi.stubEnv(name, undefined)
    }
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.deepSearch).toEqual({
      maxSearches: 10,
      maxResultsPerSearch: 10,
      maxSelectedUrlsPerRound: 30,
      maxRounds: 3,
      maxRequestChars: 10_000,
      maxSummaryContextChars: 100_000,
      maxConcurrentJobs: 2,
      maxConcurrentPageTasks: 4,
      maxActiveRootJobsPerUser: 2,
      maxSelectedPagesPerRootJob: 400,
      maxInitialIdeaSearches: 10,
    })
  })

  it("rejects unsafe deep-search configuration ceilings", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND", "101")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "DEEP_SEARCH_MAX_SELECTED_URLS_PER_ROUND",
    )
  })

  it("rejects an unsafe accumulated-summary context limit", async () => {
    vi.stubEnv("DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS", "24999")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "DEEP_SEARCH_MAX_SUMMARY_CONTEXT_CHARS",
    )
  })
})
