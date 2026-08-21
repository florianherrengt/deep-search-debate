import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { Home } from "./Home.tsx"

function DebateLocation() {
  const location = useLocation()
  return <output>{`${location.pathname}${location.search}`}</output>
}

describe("Home", () => {
  it("does not present the configurable tournament as a fixed format", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(document.body).toHaveTextContent("multiple distinct ideas")
    expect(document.body).toHaveTextContent("multiple rounds")
    expect(document.body).not.toHaveTextContent(
      /twelve|\b12\b|\b33\b|five rounds|four ideas|semifinals?/i,
    )
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Multiple researched ideas are debated by AI agents through multiple rounds until a winner emerges.",
    )
  })

  it("uses waitlist actions publicly and a compact authenticated hierarchy", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )

    expect(
      screen.getAllByRole("button", { name: "Join the waiting list" }),
    ).toHaveLength(2)
    expect(
      screen.queryByLabelText("Your problem or decision"),
    ).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <Home authenticated />
      </MemoryRouter>,
    )

    expect(
      screen.queryByRole("button", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Your debate is saved automatically.")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "See the full case" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "How agents test the ideas" })).toBeVisible()
  })

  it("hands the final question to the debate form in the URL", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Home authenticated />} />
          <Route path="/debates" element={<DebateLocation />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByText("Watch AI agents debate ideas. See which one wins."),
    ).toBeVisible()

    expect(
      screen.queryByRole("heading", { name: "See the full case" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        name: "How agents test the ideas",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "What should the agents debate?" }),
    ).toBeVisible()

    fireEvent.change(screen.getByLabelText("Your problem or decision"), {
      target: { value: "  How should we decide?  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start a debate" }))

    expect(
      screen.getByText("/debates?prompt=How%20should%20we%20decide%3F"),
    ).toBeVisible()
  })
})
