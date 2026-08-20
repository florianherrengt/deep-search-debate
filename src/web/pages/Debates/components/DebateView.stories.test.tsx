import { composeStory } from "@storybook/react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import preview from "../../../.storybook/preview.tsx"
import meta, { Completed } from "./DebateView.stories.tsx"

const CompletedStory = composeStory(Completed, meta, preview)

describe("Debate tournament stories", () => {
  it("shows feedback controls on the completed owner tournament", () => {
    render(<CompletedStory />)

    const thumbsUp = screen.getByRole("button", { name: "Thumbs up" })
    const status = screen.getByText("Debate complete")
    const feedbackSection = thumbsUp.closest("section")

    expect(thumbsUp).toBeVisible()
    expect(screen.getByRole("button", { name: "Thumbs down" })).toBeVisible()
    expect(screen.queryByText("Was this result helpful?")).not.toBeInTheDocument()
    expect(feedbackSection).toHaveAccessibleName("Result feedback")
    expect(feedbackSection?.nextElementSibling).toContainElement(status)
  })
})
