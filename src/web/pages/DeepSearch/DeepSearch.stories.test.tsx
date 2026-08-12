import { composeStory } from "@storybook/react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import preview from "../../.storybook/preview.tsx"
import meta, {
  AutomatedSelected,
  ManualSelected,
} from "./DeepSearch.stories.tsx"

const ManualStory = composeStory(ManualSelected, meta, preview)
const AutomatedStory = composeStory(AutomatedSelected, meta, preview)

describe("Deep Search history stories", () => {
  it("shows the page with manual searches selected", async () => {
    render(<ManualStory />)

    expect(screen.getByRole("tab", { name: "My Searches" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(
      await screen.findByRole("link", {
        name: /Heat-pump options for London flats/,
      }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: "Automated" }))

    expect(screen.getByRole("tab", { name: "Automated" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(
      await screen.findByRole("link", {
        name: "From debate: Fairer Home Energy Products",
      }),
    ).toBeVisible()
  })

  it("shows the page with automated searches selected", async () => {
    render(<AutomatedStory />)

    expect(screen.getByRole("tab", { name: "Automated" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(
      await screen.findByRole("link", {
        name: "From debate: Fairer Home Energy Products",
      }),
    ).toBeVisible()
  })
})
