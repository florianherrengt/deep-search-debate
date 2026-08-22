import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { ExternalLink } from "./ExternalLink.tsx"

describe("ExternalLink", () => {
  it("renders an external href that opens in a new tab with the icon hidden from assistive technology", () => {
    render(
      <ExternalLink href="https://example.com/report">
        Research report
      </ExternalLink>,
    )

    const link = screen.getByRole("link", { name: "Research report" })
    expect(link).toHaveAttribute("href", "https://example.com/report")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull()
  })

  it("renders an internal route as a link that opens in a new tab", () => {
    render(
      <MemoryRouter>
        <ExternalLink to="/ideas/energy/idea-7#improved-idea">
          Improved idea
        </ExternalLink>
      </MemoryRouter>,
    )

    const link = screen.getByRole("link", { name: "Improved idea" })
    expect(link).toHaveAttribute("href", "/ideas/energy/idea-7#improved-idea")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull()
  })
})
