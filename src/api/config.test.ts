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
})
