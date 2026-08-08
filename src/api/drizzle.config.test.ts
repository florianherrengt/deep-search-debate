import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("drizzle config", () => {
  it("migrates the production database used by the runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", undefined)
    vi.resetModules()

    const { default: drizzleConfig } = await import("./drizzle.config.ts")

    expect(drizzleConfig).toHaveProperty(
      "dbCredentials.url",
      "/app/data/data.db",
    )
  })
})
