import { composeStory } from "@storybook/react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import preview from "../../../.storybook/preview.tsx"
import { completedTournament } from "../stories/fixtures.ts"
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

  it("keeps the prompt collapsed by default and expands it", () => {
    render(<CompletedStory />)

    const promptButton = screen.getByRole("button", { name: "Prompt" })
    expect(promptButton).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText(completedTournament.prompt)).not.toBeVisible()

    fireEvent.click(promptButton)

    expect(promptButton).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(completedTournament.prompt)).toBeVisible()
  })
})
