import { render, screen, within } from "@testing-library/react"
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

  it("renders aligned table cells, escaped pipes, and unchanged source citations", () => {
    const source = "https://example.com/policy?plan=standard&region=uk#eligibility"
    render(<MarkdownText text={[
      "| Option | Monthly price | Eligibility | Source |",
      "| :--- | ---: | :---: | --- |",
      `| **Standard** | £14 | Existing \\| new customers | [Policy](${source}) |`,
    ].join("\n")} />)

    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent))
      .toEqual(["Option", "Monthly price", "Eligibility", "Source"])
    expect(within(table).getByRole("columnheader", { name: "Monthly price" }))
      .toHaveStyle({ textAlign: "right" })
    expect(within(table).getByRole("cell", { name: "£14" }))
      .toHaveStyle({ textAlign: "right" })
    expect(within(table).getByRole("cell", { name: "Existing | new customers" }))
      .toHaveStyle({ textAlign: "center" })
    expect(within(table).getByText("Standard", { selector: "strong" })).toBeVisible()
    const citation = within(table).getByRole("link", { name: "Policy" })
    expect(citation).toHaveAttribute("href", source)
    expect(citation).toHaveAttribute("target", "_blank")
    expect(citation).toHaveAttribute("rel", "noopener noreferrer")
    const scrollRegion = screen.getByRole("region", { name: "Scrollable table" })
    expect(scrollRegion).toHaveAttribute("tabindex", "0")
    expect(scrollRegion).toHaveStyle({ overflowX: "auto" })
  })

  it("keeps table focus and horizontal position as streamed rows arrive", () => {
    const { rerender } = render(<MarkdownText text="| Option | Price |" />)
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    const firstRows = "| Option | Price |\n| --- | ---: |\n| Standard | £14 |"
    rerender(<MarkdownText text={firstRows} />)
    const scrollRegion = screen.getByRole("region", { name: "Scrollable table" })
    scrollRegion.focus()
    scrollRegion.scrollLeft = 80

    rerender(<MarkdownText text={`${firstRows}\n| Flexible | £18 |\n\nPrices include tax.`} />)

    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3)
    expect(screen.getByRole("cell", { name: "£18" })).toBeVisible()
    expect(screen.getByText("Prices include tax.")).toBeVisible()
    expect(screen.getByRole("region", { name: "Scrollable table" })).toBe(scrollRegion)
    expect(scrollRegion).toHaveFocus()
    expect(scrollRegion.scrollLeft).toBe(80)
  })

  it("keeps code literal and blocks executable HTML and URLs inside tables", () => {
    const literalTable = "| Code | Value |\n| --- | --- |\n| A | B |"
    const { container } = render(<MarkdownText text={[
      "| Finding | Source |",
      "| --- | --- |",
      '| <img src="x" onerror="alert(1)"> | [Unsafe](javascript:alert%281%29) |',
      '| `<script>alert(1)</script>` | [Safe](https://example.com) |',
      "",
      "```text",
      literalTable,
      "```",
    ].join("\n")} />)

    expect(screen.getAllByRole("table")).toHaveLength(1)
    expect(container.querySelector("script, img")).toBeNull()
    expect(screen.getByText("Unsafe").closest("a"))
      .not.toHaveAttribute("href", "javascript:alert%281%29")
    expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute("href", "https://example.com")
    expect(container.querySelector("pre code")?.textContent).toBe(`${literalTable}\n`)
  })

  it("keeps footnote references and return links within the current answer", () => {
    render(<MarkdownText text={"A qualification[^1].\n\n[^1]: See the [policy](https://example.com/policy)."} />)

    const reference = screen.getByRole("link", { name: "1" })
    expect(reference).not.toHaveAttribute("target")
    const footnoteId = reference.getAttribute("href")?.slice(1) ?? ""
    expect(document.getElementById(footnoteId)).toHaveTextContent("See the policy.")
    const returnLink = screen.getByRole("link", { name: /back to/i })
    expect(returnLink).not.toHaveAttribute("target")
    expect(returnLink).toHaveAttribute("href", `#${reference.id}`)
    expect(reference.id).not.toBe("")
    expect(screen.getByRole("link", { name: "policy" })).toHaveAttribute("target", "_blank")
  })

  it("keeps repeated footnote labels in separate answers independently linked", () => {
    render(<>
      <MarkdownText text={"First answer[^1].\n\n[^1]: First qualification."} />
      <MarkdownText text={"Second answer[^1].\n\n[^1]: Second qualification."} />
    </>)

    const references = screen.getAllByRole("link", { name: "1" })
    expect(references[0].id).not.toBe(references[1].id)
    const labels = screen.getAllByRole("heading", { name: "Footnotes" })
    expect(labels[0].id).not.toBe(labels[1].id)
    expect(references[0]).toHaveAttribute("aria-describedby", labels[0].id)
    expect(references[1]).toHaveAttribute("aria-describedby", labels[1].id)
    expect(document.getElementById(references[0].getAttribute("href")?.slice(1) ?? ""))
      .toHaveTextContent("First qualification.")
    expect(document.getElementById(references[1].getAttribute("href")?.slice(1) ?? ""))
      .toHaveTextContent("Second qualification.")
    const returnLinks = screen.getAllByRole("link", { name: /back to/i })
    expect(returnLinks[0]).toHaveAttribute("href", `#${references[0].id}`)
    expect(returnLinks[1]).toHaveAttribute("href", `#${references[1].id}`)
  })
})
