import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getDebateJob,
  subscribeToDebateJob,
} from "../../lib/debateJobs.ts"
import { getErrorMessage } from "../../lib/errors.ts"

const debateJobQueryKey = (debateJobId: string) =>
  ["debate-jobs", debateJobId] as const

const INITIAL_RECONNECT_DELAY_MS = 100
const MAX_RECONNECT_DELAY_MS = 2_000

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timeout = setTimeout(finish, delayMs)
    signal.addEventListener("abort", finish, { once: true })
  })
}

/** Reads the durable snapshot, then follows lightweight invalidation events. */
export function useDebateJob(debateJobId: string) {
  const queryClient = useQueryClient()
  const [subscriptionFailure, setSubscriptionFailure] = useState<{
    debateJobId: string
    message: string
  } | null>(null)
  const query = useQuery({
    queryKey: debateJobQueryKey(debateJobId),
    queryFn: ({ signal }) => getDebateJob(debateJobId, signal),
  })

  useEffect(() => {
    if (query.data?.status !== "running") return

    const controller = new AbortController()

    void (async () => {
      let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS

      while (!controller.signal.aborted) {
        let receivedDone = false

        try {
          for await (const event of subscribeToDebateJob(
            debateJobId,
            controller.signal,
            () => setSubscriptionFailure(null),
          )) {
            if (event.type === "updated") {
              setSubscriptionFailure(null)
            } else if (event.type === "error") {
              setSubscriptionFailure({
                debateJobId,
                message: event.message,
              })
            } else {
              receivedDone = true
            }

            void queryClient.invalidateQueries({
              queryKey: debateJobQueryKey(debateJobId),
            })
          }

          if (receivedDone || controller.signal.aborted) return
          throw new Error("Debate update stream ended before completion")
        } catch (error) {
          if (controller.signal.aborted) return

          setSubscriptionFailure({
            debateJobId,
            message: getErrorMessage(error),
          })
          await waitForReconnect(controller.signal, reconnectDelayMs)
          reconnectDelayMs = Math.min(
            reconnectDelayMs * 2,
            MAX_RECONNECT_DELAY_MS,
          )
        }
      }
    })()

    return () => controller.abort()
  }, [debateJobId, query.data?.status, queryClient])

  return {
    ...query,
    subscriptionError:
      query.data?.status === "running" &&
      subscriptionFailure?.debateJobId === debateJobId
        ? subscriptionFailure.message
        : null,
  }
}
