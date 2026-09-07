import { composeStory } from "@storybook/react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import preview from "./preview.tsx"
import meta, {
  AutomatedSearches,
} from "../components/JobHistory.stories.tsx"

const AutomatedSearchesStory = composeStory(AutomatedSearches, meta, preview)

describe("Storybook preview", () => {
  it("supplies the router context required by page stories", () => {
    render(<AutomatedSearchesStory />)

    expect(
      screen.getByRole("heading", { name: "Automated searches" }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: /Evidence for time-of-use energy pricing/,
      }),
    ).toHaveAttribute(
      "href",
      "/deep-search/evidence-for-time-of-use-energy-pricing",
    )
  })
})
