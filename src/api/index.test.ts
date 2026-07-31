import { describe, expect, it } from "vitest"
import { app } from "./index.ts"
import { PingResponse } from "./routes/ping.ts"

describe("GET /api/ping", () => {
  it("returns pong", async () => {
    const res = await app.request("/api/ping")
    expect(res.status).toBe(200)
    expect(PingResponse.parse(await res.json())).toEqual({ message: "pong" })
  })
})
