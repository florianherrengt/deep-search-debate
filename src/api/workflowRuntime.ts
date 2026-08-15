import { Cause, Data, Effect, Exit, type Effect as EffectType } from "effect"

export type WorkflowStopReason = "user-stop" | "parent-stop"

type WorkflowAbortReason = {
  readonly _tag: "WorkflowAbortReason"
  readonly reason: WorkflowStopReason
}

export class WorkflowFailure extends Data.TaggedError("WorkflowFailure")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class WorkflowInterruptedError extends Error {
  override readonly name = "WorkflowInterruptedError"
  readonly reason: WorkflowStopReason

  constructor(reason: WorkflowStopReason) {
    super(reason === "user-stop" ? "Workflow stopped by user" : "Workflow stopped by parent")
    this.reason = reason
  }
}

class WorkflowDefectError extends Error {
  override readonly name = "WorkflowDefectError"
  readonly defect: unknown

  constructor(defect: unknown) {
    super("Workflow failed with an unexpected defect", { cause: defect })
    this.defect = defect
  }
}

export function workflowAbortReason(reason: WorkflowStopReason): WorkflowAbortReason {
  return { _tag: "WorkflowAbortReason", reason }
}

export function getWorkflowStopReason(
  signal: AbortSignal | undefined,
): WorkflowStopReason | undefined {
  if (!signal?.aborted) return undefined
  const reason: unknown = signal.reason
  if (
    typeof reason === "object" &&
    reason !== null &&
    "_tag" in reason &&
    reason._tag === "WorkflowAbortReason" &&
    "reason" in reason &&
    (reason.reason === "user-stop" || reason.reason === "parent-stop")
  ) {
    return reason.reason
  }
  return undefined
}

export function createWorkflowController(
  inheritedSignal?: AbortSignal,
): AbortController {
  const controller = new AbortController()
  if (!inheritedSignal) return controller

  const abortFromParent = () =>
    controller.abort(workflowAbortReason("parent-stop"))
  if (inheritedSignal.aborted) abortFromParent()
  else inheritedSignal.addEventListener("abort", abortFromParent, { once: true })
  return controller
}

/** Promise boundary for the Effect-owned orchestration introduced per workflow. */
export async function runWorkflowEffect<A>(
  effect: EffectType.Effect<A, WorkflowFailure>,
  signal?: AbortSignal,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect, signal ? { signal } : undefined)
  if (Exit.isSuccess(exit)) return exit.value

  const typedFailure = exit.cause.reasons.find(Cause.isFailReason)
  if (typedFailure) throw typedFailure.error

  const interruption = exit.cause.reasons.find(Cause.isInterruptReason)
  if (interruption) {
    throw new WorkflowInterruptedError(
      getWorkflowStopReason(signal) ?? "parent-stop",
    )
  }

  const defect = exit.cause.reasons.find(Cause.isDieReason)
  if (defect) throw new WorkflowDefectError(defect.defect)

  throw new WorkflowDefectError(Cause.squash(exit.cause))
}
