import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createTextStream: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../lib/textStreams.ts", () => ({
  createTextStream: mocks.createTextStream,
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { useTextGeneration } from "./useTextGeneration.ts"

describe("useTextGeneration", () => {
  beforeEach(() => vi.clearAllMocks())

  it("retains the stream ID while consuming its events", async () => {
    async function* events() {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Think" }
      yield { type: "text" as const, text: "Answer" }
      yield { type: "done" as const }
    }
    mocks.createTextStream.mockResolvedValue("stream-id")
    mocks.subscribeToTextStream.mockReturnValue(events())

    const { result } = renderHook(() => useTextGeneration())
    let completed

    await act(async () => {
      completed = await result.current.send({ prompt: "Hello" })
    })

    expect(completed).toEqual({
      streamId: "stream-id",
      text: "Answer",
      reasoning: "Think",
    })
    expect(result.current.streamId).toBe("stream-id")
    expect(result.current.text).toBe("Answer")
    expect(result.current.reasoning).toBe("Think")
    expect(result.current.isStreaming).toBe(false)
  })

  it("retains the stream ID and surfaces stream errors", async () => {
    async function* events() {
      await Promise.resolve()
      yield { type: "text" as const, text: "Partial" }
      yield { type: "error" as const, message: "Provider failed" }
      yield { type: "done" as const }
    }
    mocks.createTextStream.mockResolvedValue("stream-id")
    mocks.subscribeToTextStream.mockReturnValue(events())

    const { result } = renderHook(() => useTextGeneration())
    let thrown: unknown

    await act(async () => {
      try {
        await result.current.send({ prompt: "Hello" })
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toEqual(new Error("Provider failed"))
    expect(result.current.streamId).toBe("stream-id")
    expect(result.current.text).toBe("Partial")
    expect(result.current.error).toBe("Provider failed")
    expect(result.current.isStreaming).toBe(false)
  })
})
