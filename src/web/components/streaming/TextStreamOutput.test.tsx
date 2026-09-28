import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

describe("TextStreamOutput", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    JSON.stringify({ version: 1, requirements: [{ requirement: "Private structured criterion" }], queries: ["Primary eligibility source", "Independent verification"] }),
    JSON.stringify(["Primary eligibility source", "Independent verification"]),
  ])("renders current and legacy research plans as queries with retained reasoning", (text) => {
    render(<TextStreamOutput format="research-plan" stream={{ status: "completed", reasoning: "Check the qualification first.", text }} textTestId="plan" waitingText="Generating queries…" />)
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("Primary eligibility source")).toBeVisible()
    expect(screen.queryByText(/Private structured criterion/)).not.toBeInTheDocument()
    expect(screen.getByTestId("plan")).not.toHaveTextContent("version")
    fireEvent.click(screen.getByRole("button", { name: "Show reasoning" }))
    expect(screen.getByText("Check the qualification first.")).toBeVisible()
  })

  it("keeps an incomplete research plan envelope hidden while reasoning streams", () => {
    render(<TextStreamOutput format="research-plan" stream={{ status: "streaming", reasoning: "Identify the missing condition.", text: '{"version":1,"requirements":[' }} textTestId="plan" waitingText="Generating queries…" />)
    expect(screen.getByTestId("plan")).toHaveTextContent("Generating queries…")
    expect(screen.queryByText(/"version"/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show reasoning" }))
    expect(screen.getByText("Identify the missing condition.")).toBeVisible()
  })

  it("renders every discovered option in an unranked category list with its complete sources", () => {
    const options = [
      { name: "Daily road trainer", category: "Road shoes", description: "An option for daily runs on roads.", sources: ["https://example.com/road", "https://example.com/catalogue"] },
      { name: "Cushioned road trainer", category: "Road shoes", description: "Another road running approach.", sources: ["https://example.com/cushioned"] },
      { name: "Trail runner", category: "Trail shoes", description: "An option for running on trails.", sources: ["https://example.com/trail"] },
    ]
    render(<TextStreamOutput format="discovery-inventory" stream={{ status: "completed", reasoning: "", text: JSON.stringify({ options }) }} textTestId="inventory" waitingText="Discovering options…" />)
    expect(screen.getByText("3 options discovered")).toBeVisible()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(within(screen.getByRole("list", { name: "Road shoes" })).getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByRole("list", { name: "Trail shoes" }).tagName).toBe("UL")
    for (const option of options) {
      expect(screen.getByText(option.name)).toBeVisible()
      expect(screen.getByText(option.description)).toBeVisible()
    }
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(options.flatMap(({ sources }) => sources))
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
    }
    expect(screen.getByTestId("inventory")).not.toHaveTextContent('"options"')
  })

  it("hides incomplete discovery JSON until the final option inventory can be rendered", () => {
    const partial = '{"options":[{"name":"Daily trainer","category":"Road shoes"'
    const rendered = render(<TextStreamOutput format="discovery-inventory" stream={{ status: "streaming", reasoning: "", text: partial }} textTestId="inventory" waitingText="Discovering options…" />)
    expect(screen.getByTestId("inventory")).toHaveTextContent("Discovering options…")
    expect(screen.queryByText(/Daily trainer|"options"|"category"/)).not.toBeInTheDocument()
    rendered.rerender(<TextStreamOutput format="discovery-inventory" stream={{ status: "completed", reasoning: "", text: JSON.stringify({ options: [{ name: "Daily trainer", category: "Road shoes", description: "A daily running option.", sources: ["https://example.com/trainer"] }] }) }} textTestId="inventory" waitingText="Discovering options…" />)
    expect(screen.getByText("Daily trainer")).toBeVisible()
    expect(screen.queryByText("Discovering options…")).not.toBeInTheDocument()
  })

  it("announces only stream state and disables custom motion when requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    render(
      <TextStreamOutput
        announcementLabel="Final answer"
        stream={{
          status: "completed",
          reasoning: "Private reasoning",
          text: "Visible answer",
        }}
        textTestId="answer"
        waitingText="Waiting…"
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent(
      "Final answer: Response complete",
    )
    expect(screen.getByRole("status")).not.toHaveTextContent("Visible answer")
    expect(screen.getByRole("status")).toHaveStyle({
      display: "block",
      width: "1px",
    })

    const toggle = screen.getByRole("button", { name: "Show reasoning" })
    fireEvent.click(toggle)
    expect(screen.getByText("Private reasoning")).toBeVisible()
    expect(screen.getByTestId("answer-reasoning-collapse")).toHaveStyle({
      transitionDuration: "0ms",
    })
  })

  it("does not create a live region for an unlabelled child stream", () => {
    render(
      <TextStreamOutput
        stream={{
          status: "streaming",
          reasoning: "",
          text: "Partial child output",
        }}
        textTestId="child-output"
        waitingText="Waiting…"
      />,
    )

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByText("Partial child output")).toBeVisible()
  })

  it("can show reasoning without rendering the structured response", () => {
    render(
      <TextStreamOutput
        showText={false}
        stream={{
          status: "completed",
          reasoning: "Selection reasoning",
          text: '{"selectedIdeaIds":["idea-one"]}',
        }}
        textTestId="selection"
        waitingText="Selecting ideas…"
      />,
    )

    expect(screen.queryByText("selectedIdeaIds")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show reasoning" }))
    expect(screen.getByText("Selection reasoning")).toBeVisible()
  })

  it("keeps stream errors visible when the response body is hidden", () => {
    render(
      <TextStreamOutput
        showText={false}
        stream={{
          status: "error",
          reasoning: "",
          text: '{"selectedIdeaIds":["idea-one"]}',
          message: "Live response unavailable. Reload the page to try again.",
        }}
        textTestId="selection"
        waitingText="Selecting ideas…"
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Live response unavailable. Reload the page to try again.",
    )
    expect(screen.queryByText("selectedIdeaIds")).not.toBeInTheDocument()
  })

  it("renders model Markdown as formatted, safe content", () => {
    render(
      <TextStreamOutput
        format="markdown"
        stream={{
          status: "completed",
          reasoning: "",
          text: "## Findings\n\nUse **verified evidence** from [React](https://react.dev).",
        }}
        textTestId="markdown-output"
        waitingText="Waiting…"
      />,
    )

    expect(screen.getByRole("heading", { name: "Findings" })).toBeVisible()
    expect(screen.getByText("verified evidence")).toHaveStyle({
      fontWeight: "bolder",
    })
    expect(screen.getByRole("link", { name: "React" })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(screen.getByTestId("markdown-output")).not.toHaveTextContent(
      "## Findings",
    )
  })

  it("turns structured array wrappers into readable list items", () => {
    render(
      <TextStreamOutput
        format="structured-list"
        stream={{
          status: "completed",
          reasoning: "",
          text: JSON.stringify({
            elements: [
              "First query",
              { title: "Market constraints", prompt: "Research constraints" },
            ],
          }),
        }}
        textTestId="structured-output"
        waitingText="Waiting…"
      />,
    )

    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("First query")).toBeVisible()
    expect(screen.getByText("Market constraints")).toBeVisible()
    expect(screen.getByText("Research constraints")).toBeVisible()
    expect(screen.getByTestId("structured-output")).not.toHaveTextContent(
      "elements",
    )
  })
})
