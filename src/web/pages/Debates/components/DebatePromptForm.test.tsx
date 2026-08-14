import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { DebatePromptForm } from "./DebatePromptForm.tsx"

function renderForm(
  props: Partial<ComponentProps<typeof DebatePromptForm>> = {},
) {
  const onSubmit = vi.fn()
  render(
    <MemoryRouter>
      <DebatePromptForm onSubmit={onSubmit} {...props} />
    </MemoryRouter>,
  )
  return onSubmit
}

describe("DebatePromptForm", () => {
  it("keeps secondary setup hidden and starts a private-by-default flow", () => {
    const onSubmit = renderForm()

    expect(
      screen.queryByRole("switch", { name: /public/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Candidate ideas")).not.toBeInTheDocument()
    expect(screen.getByText(/Private by default/i)).toBeVisible()

    fireEvent.change(screen.getByLabelText("What should the ideas solve?"), {
      target: { value: "  Reduce food waste  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start a debate" }))

    expect(onSubmit).toHaveBeenCalledWith({
      numberOfIdeas: 8,
      prompt: "Reduce food waste",
    })
  })

  it("progressively discloses the candidate count", () => {
    const onSubmit = renderForm()

    fireEvent.click(screen.getByRole("button", { name: "Advanced options" }))
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Candidate ideas" }))
    fireEvent.click(screen.getByRole("option", { name: "6 ideas" }))
    fireEvent.change(screen.getByLabelText("What should the ideas solve?"), {
      target: { value: "Choose a market" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start a debate" }))

    expect(onSubmit).toHaveBeenCalledWith({
      numberOfIdeas: 6,
      prompt: "Choose a market",
    })
  })

  it("uses a compact review state for a prompt handed off from the landing page", () => {
    renderForm({ initialPrompt: "Should we enter this market?" })

    expect(
      screen.getByRole("heading", { name: "Review and start your debate" }),
    ).toBeVisible()
    expect(screen.getByLabelText("What should the ideas solve?")).toHaveValue(
      "Should we enter this market?",
    )
  })
})
