import { describe, expect, it } from "vitest"
import { app } from "./index.ts"
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
