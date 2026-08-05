import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { App } from "./App"

describe("App", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"))

  it("renders the heading", () => {
    render(<App />)
    expect(screen.getByText("Deep Search Debate")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Deep Search Debate" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Debates" })).toHaveAttribute(
      "href",
      "/debates",
    )
  })

  it("renders an explicit not-found screen for unknown routes", () => {
    window.history.replaceState({}, "", "/missing")

    render(<App />)

    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    )
  })
})
