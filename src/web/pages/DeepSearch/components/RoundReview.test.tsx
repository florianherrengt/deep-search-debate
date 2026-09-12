import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"

import { RoundReview } from "./RoundReview.tsx"

describe("RoundReview", () => {
  it("streams review reasoning while the decision is running", async () => {
    async function* events() {
      yield {
        type: "reasoning" as const,
        text: "Checking for a material evidence gap",
      }
      await new Promise(() => {})
    }
    const subscribe = vi.fn(() => events())

    render(
      <TextStreamProvider subscribe={subscribe}>
        <RoundReview
          review={{ round: 0, streamId: "review-stream", status: "running" }}
        />
      </TextStreamProvider>,
    )

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Round 1 research review",
      }),
    ).toBeVisible()
    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    fireEvent.click(reasoningToggle)
    expect(
      screen.getByText("Checking for a material evidence gap"),
    ).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it.each([
    [
      "continue" as const,
      "More research requested. An independent source is still missing.",
    ],
    [
      "stop" as const,
      "No further searches. The user's priorities remain unknown; web searches cannot resolve them.",
    ],
  ])("renders the %s decision and reason", (status, expected) => {
    const subscribe = vi.fn()
    render(
      <TextStreamProvider subscribe={subscribe}>
        <RoundReview
          review={{
            round: 0,
            status,
            reason:
              status === "continue"
                ? "An independent source is still missing."
                : "The user's priorities remain unknown; web searches cannot resolve them.",
          }}
        />
      </TextStreamProvider>,
    )

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Round 1 research review",
      }),
    ).toBeVisible()
    expect(screen.getByRole("alert")).toHaveTextContent(expected)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("explains the non-fatal fallback when review setup fails", () => {
    const subscribe = vi.fn()
    render(
      <TextStreamProvider subscribe={subscribe}>
        <RoundReview
          review={{
            round: 0,
            status: "error",
            reason: "The reviewer returned malformed output.",
          }}
        />
      </TextStreamProvider>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Review failed; using the current answer. The reviewer returned malformed output.",
    )
    expect(subscribe).not.toHaveBeenCalled()
  })
})
