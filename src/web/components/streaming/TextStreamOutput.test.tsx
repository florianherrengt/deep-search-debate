import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

describe("TextStreamOutput", () => {
  afterEach(() => vi.unstubAllGlobals())

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
