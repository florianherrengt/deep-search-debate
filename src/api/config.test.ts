import { describe, expect, it, vi } from "vitest";

describe("config", () => {
  it("keeps the development API private when API_HOST is unset", async () => {
    const configuredHost = process.env.API_HOST;
    delete process.env.API_HOST;
    vi.resetModules();

    try {
      const { config } = await import("./config.ts");
      expect(config.api.hostname).toBe("127.0.0.1");
    } finally {
      if (configuredHost === undefined) delete process.env.API_HOST;
      else process.env.API_HOST = configuredHost;
      vi.resetModules();
    }
  });
});
