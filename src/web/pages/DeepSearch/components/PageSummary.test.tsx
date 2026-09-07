import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PageSummary } from "./PageSummary.tsx"

function ndjsonResponse(events: Array<Record<string, unknown>>): Response {
  return new Response(
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    {
      headers: { "Content-Type": "application/x-ndjson" },
      status: 200,
    },
  )
}

function delayedNdjsonResponse(
  firstEvents: Array<Record<string, unknown>>,
  release: Promise<void>,
  finalEvents: Array<Record<string, unknown>>,
): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of firstEvents) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
        await release
        for (const event of finalEvents) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
        controller.close()
      },
    }),
    {
      headers: { "Content-Type": "application/x-ndjson" },
      status: 200,
    },
  )
}

describe("PageSummary", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("follows partial summary text through completion", async () => {
    const completion = Promise.withResolvers<void>()
    let requestUrl: RequestInfo | URL | undefined
    let requestSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = input
        requestSignal = init?.signal
        return Promise.resolve(
          delayedNdjsonResponse(
            [
              { type: "reasoning", text: "Identifying useful details" },
              { type: "text", text: "A partial summary" },
            ],
            completion.promise,
            [
              { type: "text", text: " is complete" },
              { type: "done" },
            ],
          ),
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PageSummary
        summary={{ status: "stream", streamId: "summary-stream-id" }}
      />,
    )

    expect(await screen.findByText("Summarizing source…")).toBeVisible()
    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByText("Identifying useful details"),
    ).not.toBeInTheDocument()
    fireEvent.click(reasoningToggle)
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Identifying useful details")).toBeVisible()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "A partial summary",
    )

    await act(async () => {
      completion.resolve()
      await completion.promise
    })

    expect(await screen.findByText("Source findings")).toBeVisible()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "A partial summary is complete",
    )
    expect(requestUrl).toBe("/api/streams/summary-stream-id")
    expect(requestSignal).toBeInstanceOf(AbortSignal)
  })

  it("renders extraction and failure states without opening a stream", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { rerender } = render(
      <PageSummary summary={{ status: "extracting" }} />,
    )

    expect(screen.getByText("Extracting page content…")).toBeInTheDocument()

    rerender(
      <PageSummary
        summary={{ status: "error", message: "Extraction failed" }}
      />,
    )

    expect(
      screen.getByText("Source findings unavailable"),
    ).toBeInTheDocument()
    expect(screen.getByText("Extraction failed")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reconnects instead of completing a text stream after premature EOF", async () => {
    const replay = Promise.withResolvers<void>()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ndjsonResponse([{ type: "text", text: "Partial" }]))
      .mockResolvedValueOnce(
        delayedNdjsonResponse(
          [{ type: "text", text: "Complete summary" }],
          replay.promise,
          [{ type: "done" }],
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PageSummary
        summary={{ status: "stream", streamId: "summary-stream-id" }}
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(2),
    )
    expect(
      screen.queryByText("Live response interrupted. Reconnecting…"),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "Complete summary",
    )

    await act(async () => {
      replay.resolve()
      await replay.promise
    })
    expect(await screen.findByText("Source findings")).toBeVisible()
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "Complete summary",
    )
  })

  it("ignores a late event from an aborted stream after the source changes", async () => {
    const oldRelease = Promise.withResolvers<void>()
    let oldSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (url.endsWith("/old-summary")) {
          oldSignal = init?.signal ?? undefined
          return Promise.resolve(
            delayedNdjsonResponse(
              [{ type: "text", text: "Old partial" }],
              oldRelease.promise,
              [
                { type: "text", text: "Old late event" },
                { type: "done" },
              ],
            ),
          )
        }
        return Promise.resolve(
          ndjsonResponse([
            { type: "text", text: "New summary" },
            { type: "done" },
          ]),
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(
      <PageSummary summary={{ status: "stream", streamId: "old-summary" }} />,
    )
    expect(await screen.findByTestId("page-summary-text")).toHaveTextContent(
      "Old partial",
    )

    rerender(
      <PageSummary summary={{ status: "stream", streamId: "new-summary" }} />,
    )
    expect(await screen.findByTestId("page-summary-text")).toHaveTextContent(
      "New summary",
    )
    expect(oldSignal).toBeInstanceOf(AbortSignal)
    expect(oldSignal?.aborted).toBe(true)
    expect(screen.queryByText("Old partial")).not.toBeInTheDocument()

    await act(async () => {
      oldRelease.resolve()
      await oldRelease.promise
    })
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "New summary",
    )
    expect(screen.queryByText("Old late event")).not.toBeInTheDocument()
  })

  it("shows a durable stream error while retaining partial findings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonResponse([
          { type: "text", text: "Partial findings" },
          { type: "error", message: "Summary generation failed" },
          { type: "done" },
        ]),
      ),
    )

    render(
      <PageSummary
        summary={{ status: "stream", streamId: "failed-summary" }}
      />,
    )

    expect(await screen.findByText("Source findings unavailable")).toBeVisible()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Summary generation failed",
    )
    expect(screen.getByTestId("page-summary-text")).toHaveTextContent(
      "Partial findings",
    )
  })
})
