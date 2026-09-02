import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "../lib/api.ts"
import { RequestError } from "./RequestError.tsx"

describe("RequestError", () => {
  it("uses an actionable resource view for 404 responses", () => {
    render(
      <MemoryRouter>
        <RequestError
          error={new ApiError("GET", "/api/jobs/missing", 404)}
          notFoundTitle="Job not found"
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("heading", { level: 1, name: "Job not found" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    )
  })

  it("hides technical request details and exposes retry", () => {
    const retry = vi.fn()
    render(
      <RequestError
        error={new ApiError("GET", "/api/private-path", 503)}
        onRetry={retry}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not complete the request. Try again.",
    )
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "/api/private-path",
    )
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("reports invalid JSON as an unexpected server response", () => {
    render(<RequestError error={new SyntaxError("Unexpected token")} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server returned data in an unexpected format. Try again.",
    )
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "Check your connection",
    )
  })

  it.each([
    [
      "authentication-required",
      "Your OpenAI connection has expired. Disconnect it and connect again.",
    ],
    [
      "rate-limited",
      "Your OpenAI subscription is temporarily rate-limited. Try again after its usage limit resets.",
    ],
    [
      "workspace-disabled",
      "Codex access is disabled for this OpenAI workspace. Contact its administrator or connect another account.",
    ],
    [
      "protocol-incompatible",
      "This OpenAI connection is not compatible with the current Codex integration. Try connecting again later.",
    ],
    [
      "temporarily-unavailable",
      "OpenAI Codex is temporarily unavailable. Try again later.",
    ],
    ["timeout", "OpenAI Codex timed out. Try again."],
    [
      "tool-blocked",
      "OpenAI Codex attempted to use a tool that RethinkLoop does not permit.",
    ],
  ] as const)("shows the safe client message for %s", (code, message) => {
    render(
      <RequestError
        error={new ApiError("POST", "/api/streams", 503, code)}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(message)
  })
})
