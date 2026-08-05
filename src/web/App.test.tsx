import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

describe("App", () => {
  const scrollToMock = vi.fn()

  beforeEach(() => {
    window.history.replaceState({}, "", "/")
    scrollToMock.mockClear()
    vi.stubGlobal("scrollTo", scrollToMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it("renders the product entry point", () => {
    render(<App />)
    expect(screen.getByText("Deep Search Debate")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Research, generate, and decide",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Start a tournament" }),
    ).toHaveAttribute("href", "/debates")
    expect(
      screen.queryByRole("heading", {
        name: /Move from an open question to grounded ideas/,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Deep Search Debate" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Debates" })).toHaveAttribute(
      "href",
      "/debates",
    )
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("link", { name: "Debates" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("resets scroll and moves focus into the new route", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("link", { name: "About" }))

    const heading = await screen.findByRole("heading", {
      name: "About Deep Search Debate",
    })
    expect(heading).toBeVisible()
    await waitFor(() =>
      expect(scrollToMock).toHaveBeenCalledWith({
        behavior: "auto",
        left: 0,
        top: 0,
      }),
    )
    expect(heading).toHaveFocus()
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
