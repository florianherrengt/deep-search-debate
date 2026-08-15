import PQueue from "p-queue"
import { describe, expect, it, vi } from "vitest"
import { addAbortableQueueTask } from "./addAbortableQueueTask.ts"

describe("addAbortableQueueTask", () => {
  it("removes waiting work when its signal aborts", async () => {
    const queue = new PQueue({ concurrency: 1 })
    const blocker = Promise.withResolvers<void>()
    const first = queue.add(() => blocker.promise)
    const controller = new AbortController()
    const task = vi.fn()
    const queued = addAbortableQueueTask(queue, task, controller.signal)

    controller.abort(new Error("Stopped while queued"))

    await expect(queued).rejects.toThrow("Stopped while queued")
    expect(task).not.toHaveBeenCalled()
    blocker.resolve()
    await first
  })

  it("holds an active permit until signal-aware cleanup settles", async () => {
    const queue = new PQueue({ concurrency: 1 })
    const controller = new AbortController()
    const cleanup = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const first = addAbortableQueueTask(
      queue,
      async () => {
        started.resolve()
        await cleanup.promise
      },
      controller.signal,
    )
    await started.promise
    const secondTask = vi.fn()
    const second = queue.add(secondTask)

    controller.abort(new Error("Stop active work"))
    await Promise.resolve()
    expect(secondTask).not.toHaveBeenCalled()

    cleanup.resolve()
    await first
    await second
    expect(secondTask).toHaveBeenCalledOnce()
  })

  it("preserves queue priority", async () => {
    const queue = new PQueue({ concurrency: 1, autoStart: false })
    const order: string[] = []
    const low = addAbortableQueueTask(
      queue,
      () => order.push("low"),
      undefined,
      { priority: 0 },
    )
    const high = addAbortableQueueTask(
      queue,
      () => order.push("high"),
      undefined,
      { priority: 1 },
    )

    queue.start()
    await Promise.all([low, high])
    expect(order).toEqual(["high", "low"])
  })
})
