import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  app,
  handleRequestError,
  setWebAssetCacheHeaders,
} from "./index.ts"
import type { AppEnv } from "./types/auth.ts"
import { pingResponseSchema } from "./routes/ping.ts"
import { authConfigResponseSchema } from "./routes/auth.ts"

describe("GET /api/ping", () => {
  it("returns pong", async () => {
    const res = await app.request("/api/ping")
    expect(res.status).toBe(200)
    expect(pingResponseSchema.parse(await res.json())).toEqual({ message: "pong" })
  })
})

describe("GET /api/health", () => {
  it("is public and reports that the process is healthy", async () => {
    const res = await app.request("/api/health")

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: "ok" })
  })
})

describe("request error handling", () => {
  it("preserves intentional HTTP errors", async () => {
    const testApp = new Hono<AppEnv>()
    testApp.onError(handleRequestError)
    testApp.use("*", async (context, next) => {
      context.header("X-Middleware", "kept")
      await next()
    })
    testApp.get("/teapot", () => {
      throw new HTTPException(418, { message: "Short and stout" })
    })

    const response = await testApp.request("/teapot")

    expect(response.status).toBe(418)
    expect(response.headers.get("X-Middleware")).toBe("kept")
    await expect(response.text()).resolves.toBe("Short and stout")
  })

  it("does not log provider request or response payloads", async () => {
    const sentinel = "sensitive-prompt-and-provider-response"
    const error = Object.assign(new Error(`Provider rejected ${sentinel}`), {
      name: "RetryError",
      requestBodyValues: { messages: [{ content: sentinel }] },
      responseBody: sentinel,
    })
    const testApp = new Hono<AppEnv>()
    testApp.onError(handleRequestError)
    testApp.get("/unhandled-provider-error", () => {
      throw error
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const response = await testApp.request("/unhandled-provider-error")
      const responseBody = await response.text()
      const logged = JSON.stringify(consoleError.mock.calls)

      expect(response.status).toBe(500)
      expect(responseBody).toBe("Internal Server Error")
      expect(responseBody).not.toContain(sentinel)
      expect(logged).not.toContain(sentinel)
      expect(consoleError).toHaveBeenCalledWith("Unhandled request error", {
        method: "GET",
        path: "/unhandled-provider-error",
        errorName: "RetryError",
      })
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe("static web asset caching", () => {
  function requestWithServedPath(requestPath: string, servedPath: string) {
    const testApp = new Hono<AppEnv>()
    testApp.get("*", (context) => {
      setWebAssetCacheHeaders(servedPath, context)
      return context.body(null)
    })
    return testApp.request(requestPath)
  }

  it("caches fingerprinted build assets for one year", async () => {
    const response = await requestWithServedPath(
      "/assets/index-DNLI_ZQz.js",
      "/app/src/web/dist/assets/index-DNLI_ZQz.js",
    )

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    )
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    )
  })

  it("uses a shorter CDN lifetime for stable-name assets", async () => {
    const response = await requestWithServedPath(
      "/og-image.png",
      "/app/src/web/dist/og-image.png",
    )

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=3600",
    )
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "public, max-age=86400",
    )
  })

  it("does not cache the HTML entry point", async () => {
    const response = await requestWithServedPath(
      "/",
      "/app/src/web/dist/index.html",
    )

    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "no-store",
    )
  })
})

describe("authentication", () => {
  it("keeps auth discovery public and protects application routes", async () => {
    const configResponse = await app.request("/api/auth/config")
    expect(configResponse.status).toBe(200)
    expect(authConfigResponseSchema.parse(await configResponse.json())).toEqual({
      debugUserEnabled: true,
    })

    const protectedResponse = await app.request("/api/deep-search-jobs")
    expect(protectedResponse.status).toBe(401)
    await expect(protectedResponse.json()).resolves.toEqual({
      error: "Unauthorized",
    })
  })

  it("rejects anonymous requests to every provider-backed creation route", async () => {
    for (const path of [
      "/api/streams",
      "/api/deep-search-jobs",
      "/api/idea-jobs",
      "/api/debate-jobs",
    ]) {
      const response = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
      })
    }
  })

  it("protects feedback mutations with session and trusted-origin middleware", async () => {
    for (const path of [
      "/api/deep-search-jobs/10000000-0000-4000-8000-000000000001/feedback",
      "/api/idea-jobs/20000000-0000-4000-8000-000000000002/feedback",
      "/api/debate-jobs/30000000-0000-4000-8000-000000000003/feedback",
    ]) {
      const anonymousResponse = await app.request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "rating", rating: true }),
      })
      expect(anonymousResponse.status).toBe(401)

      const crossOriginResponse = await app.request(path, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ type: "rating", rating: true }),
      })
      expect(crossOriginResponse.status).toBe(403)
    }
  })

  it("rejects untrusted debug sign-in requests", async () => {
    const response = await app.request("/api/auth/debug-sign-in", {
      method: "POST",
    })

    expect(response.status).toBe(403)
  })

  it("rejects cross-site mutations before protected work starts", async () => {
    const response = await app.request("/api/deep-search-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ researchRequest: "Spend provider credits" }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" })
  })

  it("does not expose Better Auth's generic email/password endpoints", async () => {
    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attacker@example.com",
        name: "Attacker",
        password: "arbitrary-password",
      }),
    })

    expect(response.status).toBe(404)
  })

  it("creates a Better Auth session for the local debug user", async () => {
    const signInResponse = await app.request("/api/auth/debug-sign-in", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "X-Debug-Auth": "1",
      },
    })

    expect(signInResponse.status).toBe(200)
    const sessionCookie = signInResponse.headers.get("set-cookie")?.split(";")[0]
    expect(sessionCookie).toMatch(/^better-auth\.session_token=/)

    const protectedResponse = await app.request("/api/deep-search-jobs", {
      headers: { Cookie: sessionCookie ?? "" },
    })
    expect(protectedResponse.status).toBe(200)
    await expect(protectedResponse.json()).resolves.toEqual({
      deepSearchJobs: [],
    })

    const debugResponse = await app.request(
      "/api/debug/extract?url=not-a-url",
      { headers: { Cookie: sessionCookie ?? "" } },
    )
    expect(debugResponse.status).toBe(400)
  })
})
