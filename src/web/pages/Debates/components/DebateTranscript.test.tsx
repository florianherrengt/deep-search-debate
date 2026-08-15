import { render, screen, within } from "@testing-library/react"
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
      screen.getByRole("heading", { name: "Debate conversation" }),
    ).toBeVisible()
    expect(screen.queryByText("Transcript", { exact: true })).toBeNull()

    rerender(<DebateTranscript live match={match} />)

    expect(screen.getByText("Streaming", { exact: true })).toBeVisible()
  })

  it("renders the whole conversation in normal page flow", () => {
    const conversationMatch: DebateMatch = {
      ...match,
      status: "completed",
      messages: [
        match.messages[0],
        {
          ...match.messages[0],
          debateMessageId: "second-message",
          position: 1,
          speakerSlot: 1,
          text: "Second response",
        },
        {
          ...match.messages[0],
          debateMessageId: "judge-message",
          position: 2,
          speakerSlot: 2,
          text: "Final decision",
        },
      ],
    }

    render(<DebateTranscript match={conversationMatch} />)

    const conversation = screen.getByRole("log", { name: "Debate messages" })
    expect(conversation).toHaveStyle({ overflow: "visible" })
    const messages = within(conversation).getAllByRole("article")
    expect(messages).toHaveLength(3)
    expect(messages[0]).toHaveStyle({ justifyContent: "flex-start" })
    expect(messages[1]).toHaveStyle({ justifyContent: "flex-end" })
    expect(messages[2]).toHaveStyle({ justifyContent: "center" })
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
