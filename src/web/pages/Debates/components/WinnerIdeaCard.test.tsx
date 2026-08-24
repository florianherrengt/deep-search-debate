import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { WinnerIdeaCard } from "./WinnerIdeaCard.tsx"

const idea = {
  description: "A weekly meal-prep subscription",
  ideaId: "11111111-1111-4111-8111-111111111111",
  position: 0,
  title: "Meal prep marketplace",
}

function renderCard(websiteHasScreenshot: boolean) {
  return render(
    <MemoryRouter>
      <WinnerIdeaCard
        idea={idea}
        ideaJobId="22222222-2222-4222-8222-222222222222"
        ideaJobSlug="meal-prep"
        websiteHasScreenshot={websiteHasScreenshot}
        websiteIdeaId={idea.ideaId}
      />
    </MemoryRouter>,
  )
}

describe("WinnerIdeaCard", () => {
  it("links the captured square screenshot instead of a text link", () => {
    renderCard(true)

    const image = screen.getByRole("img", {
      name: "Preview of the generated website",
    })
    expect(image.getAttribute("src")).toBe(
      `/api/idea-jobs/22222222-2222-4222-8222-222222222222/ideas/${idea.ideaId}/website/screenshot.png`,
    )
    const link = screen.getByRole("link", {
      name: "Preview of the generated website",
    })
    expect(link.getAttribute("href")).toBe(
      `/api/idea-jobs/22222222-2222-4222-8222-222222222222/ideas/${idea.ideaId}/website`,
    )
    expect(
      screen.queryByText("Open the generated website"),
    ).not.toBeInTheDocument()
  })

  it("falls back to the text link when no screenshot was captured", () => {
    renderCard(false)

    expect(
      screen.queryByRole("img", {
        name: "Preview of the generated website",
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open the generated website" }),
    ).toBeVisible()
  })
})
