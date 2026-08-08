import { describe, expect, it } from "vitest"
import { resolveViteEnvironment } from "./viteEnvironment.ts"

describe("resolveViteEnvironment", () => {
  it("uses the default development ports", () => {
    expect(resolveViteEnvironment({})).toEqual({
      port: 5173,
      apiTarget: "http://localhost:3000",
    })
  })

  it("parses a worktree's Vite port and API target", () => {
    expect(
      resolveViteEnvironment({
        VITE_PORT: "5181",
        VITE_API_TARGET: "http://localhost:3008",
      }),
    ).toEqual({
      port: 5181,
      apiTarget: "http://localhost:3008",
    })
  })

  it("rejects an invalid port", () => {
    expect(() =>
      resolveViteEnvironment({ VITE_PORT: "70000" }),
    ).toThrow("VITE_PORT")
  })
})
