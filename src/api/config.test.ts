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

  it("normalizes the configured administrator email", async () => {
    vi.stubEnv("AUTH_ADMIN_EMAIL", "  ADMIN@Example.COM  ")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.adminEmail).toBe("admin@example.com")
  })

  it("allows a blank administrator email outside production", async () => {
    vi.stubEnv("AUTH_ADMIN_EMAIL", "   ")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.adminEmail).toBeUndefined()
  })

  it("allows an omitted administrator email outside production", async () => {
    vi.stubEnv("AUTH_ADMIN_EMAIL", undefined)
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.auth.adminEmail).toBeUndefined()
  })

  it("rejects an invalid administrator email", async () => {
    vi.stubEnv("AUTH_ADMIN_EMAIL", "not-an-email")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("AUTH_ADMIN_EMAIL")
  })

  it("rejects an administrator email longer than 254 characters", async () => {
    const oversizedEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`
    expect(oversizedEmail).toHaveLength(255)
    vi.stubEnv("AUTH_ADMIN_EMAIL", oversizedEmail)
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("AUTH_ADMIN_EMAIL")
  })

  it("requires an administrator email in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_ADMIN_EMAIL", undefined)
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "production-secret-with-at-least-32-characters",
    )
    vi.stubEnv("GITHUB_CLIENT_ID", "production-github-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "production-github-client-secret")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "AUTH_ADMIN_EMAIL is required in production",
    )
  })

  it("parses ordered example debate IDs and removes duplicates", async () => {
    const firstId = "11111111-1111-4111-8111-111111111111"
    const secondId = "22222222-2222-4222-8222-222222222222"
    vi.stubEnv(
      "EXAMPLE_DEBATE_IDS",
      ` ${secondId},${firstId},${secondId} `,
    )
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.examples.debateIds).toEqual([secondId, firstId])
  })

  it("normalizes example debate IDs before removing duplicates", async () => {
    const debateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    vi.stubEnv(
      "EXAMPLE_DEBATE_IDS",
      `${debateId.toUpperCase()},${debateId}`,
    )
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.examples.debateIds).toEqual([debateId])
  })

  it("rejects an invalid example debate ID", async () => {
    vi.stubEnv("EXAMPLE_DEBATE_IDS", "not-a-uuid")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "EXAMPLE_DEBATE_IDS",
    )
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

  it("uses typed rolling creation quotas", async () => {
    vi.stubEnv("RESEARCH_JOB_CREATION_WINDOW_MS", "3600000")
    vi.stubEnv("RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "9")
    vi.stubEnv("DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "7")
    vi.stubEnv("IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "4")
    vi.stubEnv("DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "2")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.abuseProtection).toEqual({
      researchJobCreationWindowMs: 3_600_000,
      maxRootJobCreationsPerWindow: 9,
      maxDeepSearchCreationsPerWindow: 7,
      maxIdeaJobCreationsPerWindow: 4,
      maxDebateCreationsPerWindow: 2,
    })
  })

  it("rejects a per-kind creation quota above the combined quota", async () => {
    vi.stubEnv("RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "3")
    vi.stubEnv("DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW", "4")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW cannot exceed RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
    )
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
    vi.stubEnv("WEB_SEARCH_CREDITS_COST", "7")
    vi.stubEnv("SEARXNG_CATEGORIES", "general, science,science")
    vi.stubEnv("SEARXNG_MAX_CONCURRENT_REQUESTS", "2")
    vi.stubEnv("SEARXNG_MIN_INTERVAL_MS", "750")
    vi.stubEnv("SERPER_MAX_QUERIES_PER_SECOND", "40")
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
    expect(config.webSearch.creditsPerRequest).toBe(7)
    expect(config.webSearch.searxng).toMatchObject({
      categories: ["general", "science"],
      maxConcurrentRequests: 2,
      minIntervalMs: 750,
    })
    expect(config.webSearch.serper.maxQueriesPerSecond).toBe(40)
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
    vi.stubEnv("DEBATE_MAX_RESEARCH_ROUNDS_PER_CHILD", "1")
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
    expect(config.web.publicBaseUrl).toBe("http://localhost:5173")
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
    expect(config.web.publicBaseUrl).toBe("https://rethinkloop.com")
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

  it("uses Serper without SearXNG in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SEARXNG_URL", undefined)
    vi.stubEnv("SERPER_API_KEY", "production-serper-key")
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com")
    vi.stubEnv("BETTER_AUTH_SECRET", "production-secret-with-at-least-32-characters")
    vi.stubEnv("GITHUB_CLIENT_ID", "production-github-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "production-github-client-secret")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.webSearch.provider).toBe("serper")
    expect(config.webSearch.serper).toEqual({
      apiKey: "production-serper-key",
      maxQueriesPerSecond: 50,
    })
  })

  it("requires a nonblank Serper API key in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SERPER_API_KEY", "   ")
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com")
    vi.stubEnv("BETTER_AUTH_SECRET", "production-secret-with-at-least-32-characters")
    vi.stubEnv("AUTH_DEBUG_USER_ENABLED", "false")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "SERPER_API_KEY",
    )
  })

  it("rejects a Serper rate above the production plan limit", async () => {
    vi.stubEnv("SERPER_MAX_QUERIES_PER_SECOND", "51")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "SERPER_MAX_QUERIES_PER_SECOND",
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
    vi.stubEnv("NODE_ENV", "development")
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
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", " ")
    vi.stubEnv("DEEPSEEK_API_KEY", "unused-deepseek-key")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "OPENCODE_ZEN_API_KEY",
    )
  })

  it("allows an unselected provider key to be blank", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", "environment-zen-key")
    vi.stubEnv("DEEPSEEK_API_KEY", "   ")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm.provider).toBe("zen")
  })

  it("rejects OpenCode Zen outside development", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("LLM_PROVIDER", "zen")
    vi.stubEnv("LLM_MODEL_NAME", "deepseek-v4-flash-free")
    vi.stubEnv("OPENCODE_ZEN_API_KEY", "environment-zen-key")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "LLM_PROVIDER=zen is available only in development",
    )
  })

  it("allows the priced DeepSeek Pro model", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek")
    vi.stubEnv("LLM_MODEL_NAME", "deepseek-v4-pro")
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-deepseek-key")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "environment-deepseek-key",
    })
  })

  it("rejects an unpriced DeepSeek model", async () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek")
    vi.stubEnv("LLM_MODEL_NAME", "unsupported-deepseek-model")
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-deepseek-key")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow(
      "LLM_MODEL_NAME must be deepseek-v4-flash or deepseek-v4-pro when LLM_PROVIDER=deepseek",
    )
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
      model: "deepseek-v4-flash",
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
      "RESEARCH_JOB_CREATION_WINDOW_MS",
      "RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
      "DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
      "IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
      "DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW",
      "RESEARCH_MAX_ACTIVE_ROOT_JOBS_PER_USER",
      "RESEARCH_MAX_SELECTED_PAGES_PER_ROOT_JOB",
      "IDEA_JOB_MAX_IDEA_COUNT",
      "IDEA_JOB_MAX_DEEP_SEARCH_COUNT",
      "DEBATE_MAX_IDEA_COUNT",
      "DEBATE_MAX_INITIAL_DEEP_SEARCH_COUNT",
      "DEBATE_MAX_SEARCHES_PER_CHILD",
      "DEBATE_MAX_RESULTS_PER_SEARCH",
      "DEBATE_MAX_RESEARCH_ROUNDS_PER_CHILD",
      "DEBATE_MAX_SELECTED_PAGES_PER_JOB",
    ]) {
      vi.stubEnv(name, undefined)
    }
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.deepSearch).toEqual({
      maxSearches: 5,
      maxResultsPerSearch: 5,
      maxSelectedUrlsPerRound: 15,
      maxRounds: 2,
      maxRequestChars: 10_000,
      maxSummaryContextChars: 100_000,
      maxConcurrentJobs: 2,
      maxConcurrentPageTasks: 4,
      maxActiveRootJobsPerUser: 2,
      maxSelectedPagesPerRootJob: 200,
      maxInitialIdeaSearches: 2,
      maxIdeaCount: 12,
    })
    expect(config.abuseProtection).toEqual({
      researchJobCreationWindowMs: 86_400_000,
      maxRootJobCreationsPerWindow: 5,
      maxDeepSearchCreationsPerWindow: 4,
      maxIdeaJobCreationsPerWindow: 2,
      maxDebateCreationsPerWindow: 1,
    })
    expect(config.debate).toEqual({
      maxIdeaCount: 8,
      maxInitialDeepSearches: 1,
      maxSearchesPerChild: 3,
      maxResultsPerSearch: 3,
      maxResearchRoundsPerChild: 1,
      maxSelectedPagesPerJob: 81,
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
