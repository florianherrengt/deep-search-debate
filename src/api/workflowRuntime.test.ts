import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  createWorkflowController,
  getWorkflowStopReason,
  runWorkflowEffect,
  WorkflowFailure,
  WorkflowInterruptedError,
  workflowAbortReason,
} from "./workflowRuntime.ts"

describe("workflow Effect runtime", () => {
  it("returns successful values", async () => {
    await expect(runWorkflowEffect(Effect.succeed("done"))).resolves.toBe("done")
  })

  it("preserves the tagged workflow failure", async () => {
    const failure = new WorkflowFailure({ message: "expected failure" })
    await expect(runWorkflowEffect(Effect.fail(failure))).rejects.toBe(failure)
  })

  it("classifies fiber interruption", async () => {
    const controller = new AbortController()
    controller.abort(workflowAbortReason("user-stop"))

    await expect(
      runWorkflowEffect(Effect.never, controller.signal),
    ).rejects.toEqual(new WorkflowInterruptedError("user-stop"))
  })

  it("wraps defects separately", async () => {
    const defect = new Error("programming bug")
    await expect(
      runWorkflowEffect(Effect.die(defect)),
    ).rejects.toMatchObject({
      name: "WorkflowDefectError",
      defect,
    })
  })

  it("propagates debate cancellation through idea and deep-search controllers", () => {
    const debate = createWorkflowController()
    const idea = createWorkflowController(debate.signal)
    const deepSearch = createWorkflowController(idea.signal)

    debate.abort(workflowAbortReason("user-stop"))

    expect(getWorkflowStopReason(debate.signal)).toBe("user-stop")
    expect(getWorkflowStopReason(idea.signal)).toBe("parent-stop")
    expect(getWorkflowStopReason(deepSearch.signal)).toBe("parent-stop")
  })
})
