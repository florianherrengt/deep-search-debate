import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ResultFeedback as ResultFeedbackState } from "../lib/resultFeedback.ts"
import { ResultFeedback } from "./ResultFeedback.tsx"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

it.each([
  ["ordinary", false],
  ["icon-only", true],
])("shows the localized run cost beside the thumbs in %s mode", (_mode, iconOnly) => {
  render(
    <ResultFeedback
      creditsUsed={1_234}
      feedback={{ rating: null, hasWrittenFeedback: false }}
      iconOnly={iconOnly}
      onRatingChange={vi.fn()}
      onSubmitText={vi.fn()}
      pending={false}
    />,
  )

  const thumbsUp = screen.getByRole("button", { name: "Thumbs up" })
  const cost = screen.getByText(
    `${(1_234).toLocaleString()} credits`,
  )
  expect(thumbsUp.parentElement?.parentElement).toContainElement(cost)
})

it("waits for a saved negative rating before selecting it and opening the dialog", async () => {
  const saved = deferred()

  function Harness() {
    const [feedback, setFeedback] = useState<ResultFeedbackState>({
      rating: null,
      hasWrittenFeedback: false,
    })
    return (
      <ResultFeedback
        creditsUsed={123}
        feedback={feedback}
        onRatingChange={async (rating) => {
          await saved.promise
          setFeedback({ rating, hasWrittenFeedback: false })
        }}
        onSubmitText={vi.fn()}
        pending={false}
      />
    )
  }

  render(<Harness />)
  const down = screen.getByRole("button", { name: "Thumbs down" })
  fireEvent.click(down)

  expect(down).toHaveAttribute("aria-pressed", "false")
  expect(
    screen.queryByRole("dialog", { name: "What could be improved?" }),
  ).not.toBeInTheDocument()

  act(() => saved.resolve())

  await waitFor(() => expect(down).toHaveAttribute("aria-pressed", "true"))
  expect(
    screen.getByRole("dialog", { name: "What could be improved?" }),
  ).toBeVisible()
})

describe("written feedback", () => {
  it("reopens for a selected negative rating without another rating request", () => {
    const onRatingChange = vi.fn()
    render(
      <ResultFeedback
        creditsUsed={123}
        feedback={{ rating: false, hasWrittenFeedback: false }}
        onRatingChange={onRatingChange}
        onSubmitText={vi.fn()}
        pending={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }))

    expect(onRatingChange).not.toHaveBeenCalled()
    expect(
      screen.getByRole("dialog", { name: "What could be improved?" }),
    ).toBeVisible()
  })

  it("trims non-empty text and closes only after it saves", async () => {
    const saved = deferred()
    const onSubmitText = vi.fn(() => saved.promise)
    render(
      <ResultFeedback
        creditsUsed={123}
        feedback={{ rating: false, hasWrittenFeedback: false }}
        onRatingChange={vi.fn()}
        onSubmitText={onSubmitText}
        pending={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }))
    const submit = screen.getByRole("button", { name: "Submit feedback" })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "  The sources missed recent evidence.  " },
    })
    fireEvent.click(submit)

    expect(onSubmitText).toHaveBeenCalledWith(
      "The sources missed recent evidence.",
    )
    expect(screen.getByLabelText("Feedback")).toHaveValue(
      "  The sources missed recent evidence.  ",
    )

    act(() => saved.resolve())
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
  })

  it("keeps the dialog and draft when saving text fails", async () => {
    const onSubmitText = vi.fn().mockRejectedValue(new Error("failed"))
    const { rerender } = render(
      <ResultFeedback
        creditsUsed={123}
        feedback={{ rating: false, hasWrittenFeedback: false }}
        onRatingChange={vi.fn()}
        onSubmitText={onSubmitText}
        pending={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }))
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Please show source dates" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }))
    await waitFor(() => expect(onSubmitText).toHaveBeenCalled())

    rerender(
      <ResultFeedback
        creditsUsed={123}
        error="The request could not be completed."
        feedback={{ rating: false, hasWrittenFeedback: false }}
        onRatingChange={vi.fn()}
        onSubmitText={onSubmitText}
        pending={false}
      />,
    )

    expect(screen.getByRole("dialog")).toBeVisible()
    expect(screen.getByLabelText("Feedback")).toHaveValue(
      "Please show source dates",
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The request could not be completed.",
    )
  })
})
