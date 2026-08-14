import { describe, expect, it } from "vitest"
import { appTheme } from "./theme.ts"

describe("appTheme", () => {
  it("uses the dark palette as an application contract", () => {
    expect(appTheme.palette.mode).toBe("dark")
    expect(appTheme.palette.primary.main).toBe("#8AB4F8")
    expect(appTheme.palette.background.default).toBe("#0B0D10")
    expect(appTheme.typography.h3.fontFamily).toBe(
      appTheme.typography.fontFamily,
    )
    expect(appTheme.vars).toBeDefined()
  })

  it("removes native heading margins from semantic accordion slots", () => {
    expect(
      appTheme.components?.MuiAccordion?.styleOverrides,
    ).toHaveProperty("heading.all", "unset")
  })
})
