import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import {
  extractPdfInProcess,
  type PdfProcessHandle,
} from "./pdfProcessClient.ts"

class FakeProcess extends EventEmitter implements PdfProcessHandle {
  readonly send = vi.fn<PdfProcessHandle["send"]>((_message, callback) => {
    callback(null)
    return true
  })
  readonly kill = vi.fn((_signal: NodeJS.Signals) => {
    queueMicrotask(() => this.emit("exit", null, "SIGKILL"))
    return true
  })
}

const input = {
  bytes: new TextEncoder().encode("%PDF-1.7"),
  maxPages: 10,
  maxTextChars: 100,
  timeoutMs: 25,
}

describe("extractPdfInProcess", () => {
  it("kills the parser when its deadline expires", async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeProcess()
      const pending = extractPdfInProcess(input, () => child)
      const rejected = pending.then(
        () => new Error("Expected parser timeout"),
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(input.timeoutMs)
      await expect(rejected).resolves.toMatchObject({ message: "PDF parsing timed out" })
      expect(child.kill).toHaveBeenCalledWith("SIGKILL")
    } finally {
      vi.useRealTimers()
    }
  })

  it("kills the parser when the caller aborts", async () => {
    const child = new FakeProcess()
    const controller = new AbortController()
    const pending = extractPdfInProcess(
      { ...input, signal: controller.signal },
      () => child,
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(child.kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("waits for the child to exit after receiving extracted text", async () => {
    const child = new FakeProcess()
    child.kill.mockImplementation(() => true)
    const pending = extractPdfInProcess(input, () => child)
    const result = { pages: ["Extracted text"], totalPages: 1, truncatedBy: null }
    let settled = false
    void pending.finally(() => { settled = true })

    child.emit("message", result)
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit("exit", null, "SIGKILL")
    await expect(pending).resolves.toEqual(result)
    expect(child.send).toHaveBeenCalledOnce()
    const sentMessage = child.send.mock.calls[0]?.[0]
    expect(sentMessage?.bytes).toBeInstanceOf(ArrayBuffer)
    expect(sentMessage).toMatchObject({ maxPages: 10, maxTextChars: 100 })
  })
})
