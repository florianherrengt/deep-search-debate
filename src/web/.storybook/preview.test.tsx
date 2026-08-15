import { composeStory } from "@storybook/react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import preview from "./preview.tsx"
import meta, {
  Ready,
} from "../pages/Debates/components/DebatePromptForm.stories.tsx"

const ReadyStory = composeStory(Ready, meta, preview)

describe("Storybook preview", () => {
  it("supplies the router context required by page stories", () => {
    render(<ReadyStory />)

    expect(
      screen.queryByRole("link", { name: "Only generate options" }),
    ).not.toBeInTheDocument()
  })
})
