import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MarkdownText } from "./MarkdownText.tsx"

describe("MarkdownText", () => {
  it("renders markdown structure instead of raw syntax", () => {
    render(
      <MarkdownText
        text={"**Bold goal**\n\n- First\n- Second\n\nSee [docs](https://example.com)"}
      />,
    )

    expect(
      screen.getByText("Bold goal", { selector: "strong" }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    const link = screen.getByRole("link", { name: "docs" })
    expect(link).toHaveAttribute("href", "https://example.com")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("keeps separate paragraphs for blank-line separated input", () => {
    const { container } = render(<MarkdownText text={"First\n\nSecond"} />)

    expect(container.querySelectorAll("p")).toHaveLength(2)
    expect(screen.getByText("First")).toBeInTheDocument()
    expect(screen.getByText("Second")).toBeInTheDocument()
  })

  it("applies caller styles to the wrapper", () => {
    const { container } = render(
      <MarkdownText sx={{ maxWidth: "85ch" }} text="text" />,
    )

    expect(container.firstElementChild).toHaveStyle({ maxWidth: "85ch" })
  })
})
