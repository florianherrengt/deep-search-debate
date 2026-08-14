import Button from "@mui/material/Button"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ProgressCard } from "./ProgressCard.tsx"

describe("ProgressCard", () => {
  it("uses the accordion heading as the stage heading", () => {
    render(
      <ProgressCard status="waiting" title="Plan the research">
        <p>Stage details</p>
      </ProgressCard>,
    )

    expect(
      screen.getByRole("heading", { level: 3, name: /Plan the research/ }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { level: 2, name: "Plan the research" }),
    ).not.toBeInTheDocument()
  })

  it("preserves a manual expansion choice when the stage status changes", () => {
    const { rerender } = render(
      <ProgressCard status="waiting" title="Generate ideas">
        <Button>Inspect ideas</Button>
      </ProgressCard>,
    )

    const toggle = screen.getByRole("button", { name: /Generate ideas/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    act(() => screen.getByRole("button", { name: "Inspect ideas" }).focus())

    rerender(
      <ProgressCard status="completed" title="Generate ideas">
        <Button>Inspect ideas</Button>
      </ProgressCard>,
    )

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Inspect ideas" })).toHaveFocus()
  })

  it("explains a stage that did not run", () => {
    render(
      <ProgressCard status="not-run" title="Summarise the research">
        <p>Unavailable summary</p>
      </ProgressCard>,
    )

    const toggle = screen.getByRole("button", {
      name: /Summarise the research Not run/,
    })
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(toggle)

    expect(
      screen.getByText(
        "This stage did not run because an earlier stage failed.",
      ),
    ).toBeVisible()
    expect(screen.queryByText("Unavailable summary")).not.toBeInTheDocument()
  })
})
