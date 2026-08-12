import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ subscribeToTextStream: vi.fn() }))

vi.mock("../../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))
import { ResearchRound } from "./ResearchRound.tsx"

describe("ResearchRound", () => {
  beforeEach(() => vi.clearAllMocks())

  it("collapses a finished round with its review answer in the header", () => {
    render(
      <ResearchRound
        finished
        review={{
          round: 0,
          status: "stop",
          reason: "The evidence covers every requested angle.",
        }}
        round={0}
        searches={[]}
      />,
    )

    const toggle = screen.getByRole("button", { name: /Round 1/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(
      within(toggle).getByText("The evidence covers every requested angle."),
    ).toBeVisible()
    expect(screen.getByRole("alert", { hidden: true })).not.toBeVisible()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("alert")).toBeVisible()
  })

  it("expands a round while research is active", () => {
    render(<ResearchRound finished={false} round={1} searches={[]} />)

    expect(screen.getByRole("button", { name: /Round 2/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it("shows the candidate answer before its review", async () => {
    async function* answerEvents() {
      await Promise.resolve()
      yield { type: "text" as const, text: "The current researched answer." }
      yield { type: "done" as const }
    }
    mocks.subscribeToTextStream.mockReturnValue(answerEvents())

    render(
      <ResearchRound
        answerStreamId="answer-stream"
        finished={false}
        round={0}
        searches={[]}
      />,
    )

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Round 1 candidate answer",
      }),
    ).toBeVisible()
    expect(await screen.findByTestId("round-answer-0")).toHaveTextContent(
      "The current researched answer.",
    )
  })
})
