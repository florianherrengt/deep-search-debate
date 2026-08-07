import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock("./keepassSecrets.ts")
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

  it("falls back to the environment-specific KeePass database", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", undefined)
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm.deepseek.apiKey).toBe("keepass-deepseek-key")
  })

  it("prefers a nonblank environment secret", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "environment-deepseek-key")
    vi.resetModules()

    const { config } = await import("./config.ts")

    expect(config.llm.deepseek.apiKey).toBe("environment-deepseek-key")
  })

  it("rejects a blank environment secret instead of falling back", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "   ")
    vi.resetModules()

    await expect(import("./config.ts")).rejects.toThrow("DEEPSEEK_API_KEY")
  })

  it("loads KeePass once even when every secret has an override", async () => {
    const actual = await vi.importActual<typeof import("./keepassSecrets.ts")>(
      "./keepassSecrets.ts",
    )
    const loadKeePassSecrets = vi.fn().mockResolvedValue({})
    vi.doMock("./keepassSecrets.ts", () => ({
      ...actual,
      loadKeePassSecrets,
    }))
    vi.resetModules()

    const firstImport = await import("./config.ts")
    const secondImport = await import("./config.ts")

    expect(firstImport.config).toBe(secondImport.config)
    expect(loadKeePassSecrets).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ requiredTitles: [] }),
    )
  })
})
