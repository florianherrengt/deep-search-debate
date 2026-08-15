import PQueue, { type QueueAddOptions } from "p-queue"

type QueueTaskOptions = Pick<QueueAddOptions, "id" | "priority" | "timeout">

/**
 * Removes waiting work on abort while keeping an active queue permit until the
 * signal-aware task has actually settled.
 */
export function addAbortableQueueTask<Result>(
  queue: PQueue,
  task: () => Promise<Result> | Result,
  signal?: AbortSignal,
  options: QueueTaskOptions = {},
): Promise<Result> {
  if (!signal) return queue.add(async () => task(), options)

  const queuedController = new AbortController()
  const abortWhileQueued = () => queuedController.abort(signal.reason)
  if (signal.aborted) abortWhileQueued()
  else signal.addEventListener("abort", abortWhileQueued, { once: true })

  return queue
    .add(
      async () => {
        signal.removeEventListener("abort", abortWhileQueued)
        return task()
      },
      { ...options, signal: queuedController.signal },
    )
    .finally(() => signal.removeEventListener("abort", abortWhileQueued))
}
