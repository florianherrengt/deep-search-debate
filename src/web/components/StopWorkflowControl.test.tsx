import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { StopWorkflowControl } from "./StopWorkflowControl.tsx"

describe("StopWorkflowControl", () => {
  it("renders nothing when the workflow cannot be stopped", () => {
    const { container } = render(
      <StopWorkflowControl canStop={false} pending={false} onConfirm={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("confirms the resumable stop with exact credit copy", () => {
    const onConfirm = vi.fn()
    render(
      <StopWorkflowControl canStop pending={false} onConfirm={onConfirm} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Stop workflow" }))
    expect(
      screen.getByRole("dialog", { name: "Stop this workflow?" }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Stopping ends the current run. Completed work is kept, and you can resume it later.",
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Completed usage remains charged; stopped in-progress attempts do not debit RethinkLoop credits.",
      ),
    ).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Stop workflow" }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("disables cancellation controls while pending", () => {
    render(
      <StopWorkflowControl canStop pending onConfirm={vi.fn()} />,
    )
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled()
  })

  it("keeps a disabled stopping control visible after durable acceptance", () => {
    render(
      <StopWorkflowControl
        canStop={false}
        pending={false}
        stopping
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled()
    expect(
      screen.queryByRole("dialog", { name: "Stop this workflow?" }),
    ).not.toBeInTheDocument()
  })

  it("does not reopen the confirmation after a stopped workflow resumes", async () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <StopWorkflowControl canStop pending={false} onConfirm={onConfirm} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Stop workflow" }))
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Stop this workflow?" }),
      ).getByRole("button", { name: "Stop workflow" }),
    )

    rerender(
      <StopWorkflowControl
        canStop={false}
        pending={false}
        stopping
        onConfirm={onConfirm}
      />,
    )
    rerender(
      <StopWorkflowControl canStop pending={false} onConfirm={onConfirm} />,
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Stop this workflow?" }),
      ).not.toBeInTheDocument(),
    )
  })
})
