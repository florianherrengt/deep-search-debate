import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  failDeepSearchJob: vi.fn(),
  interruptDeepSearchJob: vi.fn(),
  runDeepSearchPipeline: vi.fn(),
}))

vi.mock("./jobLifecycle.ts", () => ({
  failDeepSearchJob: mocks.failDeepSearchJob,
  interruptDeepSearchJob: mocks.interruptDeepSearchJob,
}))
vi.mock("./pipeline.ts", () => ({
  runDeepSearchPipeline: mocks.runDeepSearchPipeline,
}))

import { createReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { runDeepSearchJob } from "./run.ts"
import type { DeepSearchJobEvent } from "./schemas.ts"
import {
  WorkflowInterruptedError,
  workflowAbortReason,
} from "../../workflowRuntime.ts"

async function collectEvents(
  events: AsyncIterable<DeepSearchJobEvent>,
): Promise<DeepSearchJobEvent[]> {
  const collected: DeepSearchJobEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe("runDeepSearchJob", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the persisted final text and publishes one done event", async () => {
    mocks.runDeepSearchPipeline.mockResolvedValue("Persisted final answer")
    const job = createReplayableEventLog<DeepSearchJobEvent>()
    const events = collectEvents(job.subscribe())

    await expect(
      runDeepSearchJob(
        "job-id",
        "test-user-id",
        job,
        "Research this",
        3,
        3,
        2,
      ),
    ).resolves.toBe("Persisted final answer")

    await expect(events).resolves.toEqual([{ type: "done" }])
    expect(mocks.failDeepSearchJob).not.toHaveBeenCalled()
  })

  it("persists and publishes the same fatal pipeline error", async () => {
    mocks.runDeepSearchPipeline.mockRejectedValue(
      new Error("Query summary failed"),
    )
    const job = createReplayableEventLog<DeepSearchJobEvent>()
    const events = collectEvents(job.subscribe())

    await expect(
      runDeepSearchJob(
        "job-id",
        "test-user-id",
        job,
        "Research this",
        3,
        3,
        2,
      ),
    ).rejects.toThrow("Query summary failed")

    expect(mocks.failDeepSearchJob).toHaveBeenCalledWith(
      "job-id",
      "Query summary failed",
    )
    await expect(events).resolves.toEqual([
      { type: "error", message: "Query summary failed" },
      { type: "done" },
    ])
  })

  it("publishes the Stop suffix without an ordinary error event", async () => {
    mocks.runDeepSearchPipeline.mockRejectedValue(
      new WorkflowInterruptedError("user-stop"),
    )
    const controller = new AbortController()
    controller.abort(workflowAbortReason("user-stop"))
    const job = createReplayableEventLog<DeepSearchJobEvent>()
    const events = collectEvents(job.subscribe())

    await expect(
      runDeepSearchJob(
        "job-id",
        "test-user-id",
        job,
        "Research this",
        3,
        3,
        2,
        controller.signal,
      ),
    ).rejects.toThrow("Workflow stopped by user")

    expect(mocks.interruptDeepSearchJob).toHaveBeenCalledWith(
      "job-id",
      "Workflow stopped by user",
    )
    expect(mocks.failDeepSearchJob).not.toHaveBeenCalled()
    await expect(events).resolves.toEqual([
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
    ])
  })
})
