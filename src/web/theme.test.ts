import { describe, expect, it } from "vitest"
import { appTheme } from "./theme.ts"

describe("appTheme", () => {
  it("uses the dark palette as an application contract", () => {
    expect(appTheme.palette.mode).toBe("dark")
    expect(appTheme.palette.background.default).toBe("#0B0D10")
    expect(appTheme.vars).toBeDefined()
  })
})
