import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { DebateMatch } from "../debateUiTypes.ts"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import { DebateTranscript } from "./DebateTranscript.tsx"

const match: DebateMatch = {
  debateMatchId: "match",
  position: 0,
  firstIdea: {
    ideaId: "first",
    position: 0,
    title: "First idea",
    description: "First description",
  },
  secondIdea: {
    ideaId: "second",
    position: 1,
    title: "Second idea",
    description: "Second description",
  },
  winnerIdeaId: null,
  status: "running",
  messages: [
    {
      debateMessageId: "message",
      llmGenerationId: "generation",
      position: 0,
      speakerSlot: 0,
      text: "Opening argument",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
}

function setViewportGeometry(viewport: HTMLElement, scrollTop: number) {
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1_000 },
  })
  viewport.scrollTop = scrollTop
  fireEvent.scroll(viewport)
}

function withStreamedText(text: string): DebateMatch {
  return {
    ...match,
    messages: [{ ...match.messages[0], text }],
  }
}

describe("DebateTranscript", () => {
  it("shows a status beside the transcript heading only while live", () => {
    const completedMatch: DebateMatch = {
      ...match,
      status: "completed",
    }
    const { rerender } = render(
      <DebateTranscript live={false} match={completedMatch} />,
    )

    expect(
      screen.getByRole("heading", { name: "Debate transcript" }),
    ).toBeVisible()
    expect(screen.queryByText("Transcript", { exact: true })).toBeNull()

    rerender(<DebateTranscript live match={match} />)

    expect(screen.getByText("Streaming", { exact: true })).toBeVisible()
  })

  it("keeps a full-page mobile transcript scrollable without overriding manual reading", () => {
    const { rerender } = render(<DebateTranscript fullPage match={match} />)
    const viewport = screen.getByRole("log")

    expect(viewport).toHaveStyle({
      maxHeight: "min(520px, 60vh)",
      minHeight: "0",
    })

    setViewportGeometry(viewport, 100)
    rerender(
      <DebateTranscript
        fullPage
        match={withStreamedText("Updated argument")}
      />,
    )
    expect(viewport.scrollTop).toBe(100)

    setViewportGeometry(viewport, 790)
    rerender(
      <DebateTranscript
        fullPage
        match={withStreamedText("Another updated argument")}
      />,
    )
    expect(viewport.scrollTop).toBe(1_000)
  })

  it("does not override manual scrolling while text streams", () => {
    const { rerender } = render(<DebateTranscript match={match} />)
    const viewport = screen.getByRole("log")
    setViewportGeometry(viewport, 100)

    rerender(<DebateTranscript match={withStreamedText("Updated argument")} />)

    expect(viewport.scrollTop).toBe(100)
  })

  it("continues following streamed text when already near the bottom", () => {
    const { rerender } = render(<DebateTranscript match={match} />)
    const viewport = screen.getByRole("log")
    setViewportGeometry(viewport, 790)

    rerender(<DebateTranscript match={withStreamedText("Updated argument")} />)

    expect(viewport.scrollTop).toBe(1_000)
  })

  it("shows one visible role label for a judge message", () => {
    const judgeMatch: DebateMatch = {
      ...match,
      status: "completed",
      messages: [
        {
          ...match.messages[0],
          speakerSlot: 2,
          text: "The first idea makes the stronger case.",
        },
      ],
    }

    render(<DebateTranscript match={judgeMatch} />)

    const message = within(screen.getByRole("log")).getByRole("article")
    const roleLabels = within(message).getAllByText("Judge")
    expect(roleLabels).toHaveLength(1)
    expect(roleLabels[0]).toBeVisible()
  })

  it("does not expose a running judge's structured stream", () => {
    const subscribe = vi.fn(async function* () {
      await Promise.resolve()
      yield { type: "text" as const, text: '{"winnerSlot":0' }
      yield { type: "done" as const }
    })
    const judgeMatch: DebateMatch = {
      ...match,
      messages: [
        {
          ...match.messages[0],
          debateMessageId: "judge-message",
          llmGenerationId: "judge-generation",
          speakerSlot: 2,
          text: "",
        },
      ],
    }

    render(
      <TextStreamProvider subscribe={subscribe}>
        <DebateTranscript match={judgeMatch} />
      </TextStreamProvider>,
    )

    expect(subscribe).not.toHaveBeenCalled()
    expect(screen.queryByText(/winnerSlot/)).not.toBeInTheDocument()
  })

  it("streams every concurrently running agent message", async () => {
    const subscribe = vi.fn(async function* (streamId: string) {
      await Promise.resolve()
      yield { type: "text" as const, text: `Live ${streamId}` }
      yield { type: "done" as const }
    })
    const concurrentMatch: DebateMatch = {
      ...match,
      messages: [
        { ...match.messages[0], text: "" },
        {
          ...match.messages[0],
          debateMessageId: "second-message",
          llmGenerationId: "second-generation",
          position: 1,
          speakerSlot: 1,
          text: "",
        },
      ],
    }

    render(
      <TextStreamProvider subscribe={subscribe}>
        <DebateTranscript match={concurrentMatch} />
      </TextStreamProvider>,
    )

    expect(await screen.findByText("Live generation")).toBeVisible()
    expect(await screen.findByText("Live second-generation")).toBeVisible()
    expect(subscribe).toHaveBeenCalledTimes(2)
  })
})
