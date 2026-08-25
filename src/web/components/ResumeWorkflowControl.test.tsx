import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ResumeWorkflowControl } from "./ResumeWorkflowControl.tsx"

describe("ResumeWorkflowControl", () => {
  it("renders only when the server allows resumption", () => {
    const { container } = render(
      <ResumeWorkflowControl
        canResume={false}
        pending={false}
        onResume={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("requests resumption", () => {
    const onResume = vi.fn()
    render(
      <ResumeWorkflowControl canResume pending={false} onResume={onResume} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Resume workflow" }))

    expect(onResume).toHaveBeenCalledOnce()
  })

  it("shows a disabled pending state", () => {
    render(
      <ResumeWorkflowControl canResume pending onResume={vi.fn()} />,
    )

    expect(screen.getByRole("button", { name: "Resuming…" })).toBeDisabled()
  })
})
