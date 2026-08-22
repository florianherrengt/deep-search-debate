import { composeStory } from "@storybook/react"
import { fireEvent, render, screen, within } from "@testing-library/react"
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

  it("shows the winning idea's pros and cons with a new-tab title link", () => {
    render(<CompletedStory />)

    const prosAndCons = screen.getByRole("region", { name: "Pros and cons" })
    expect(
      within(prosAndCons).getByRole("heading", { name: "Pros" }),
    ).toBeVisible()
    expect(
      within(prosAndCons).getByRole("heading", { name: "Cons" }),
    ).toBeVisible()
    expect(
      within(prosAndCons).getByText(/highest-leverage decision point/),
    ).toBeVisible()
    expect(
      within(prosAndCons).getByText(/forecast accuracy/),
    ).toBeVisible()
    const winnerHeading = screen.getByRole("heading", {
      name: "Prep Forecast",
    })
    expect(within(winnerHeading).getByRole("link")).toHaveAttribute(
      "href",
      "/ideas/independent-cafe-energy-ideas/idea-prep-forecast#improved-idea",
    )
    expect(within(winnerHeading).getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    )
    const alternativeLink = within(
      screen.getByRole("region", { name: "Closest alternative" }),
    ).getByRole("link", { name: "Closing Loop" })
    expect(alternativeLink).toHaveAttribute(
      "href",
      "/ideas/independent-cafe-energy-ideas/idea-closing-loop#improved-idea",
    )
    expect(alternativeLink).toHaveAttribute("target", "_blank")
  })
})
