import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getDebateJob,
  subscribeToDebateJob,
} from "../../lib/debateJobs.ts"
import { followReplayableStream } from "../../lib/replayStream.ts"

export const debateJobQueryKey = (slug: string) =>
  ["debate-jobs", slug] as const

/** Reads the durable snapshot, then follows lightweight invalidation events. */
export function useDebateJob(slug: string) {
  const queryClient = useQueryClient()
  const [subscriptionFailure, setSubscriptionFailure] = useState<{
    debateJobId: string
    message: string
  } | null>(null)
  const query = useQuery({
    queryKey: debateJobQueryKey(slug),
    queryFn: ({ signal }) => getDebateJob(slug, signal),
  })
  const debateJobId = query.data?.debateJobId

  useEffect(() => {
    if (!debateJobId || query.data?.status !== "running") return

    const controller = new AbortController()

    void followReplayableStream({
      signal: controller.signal,
      subscribe: (onOpen) =>
        subscribeToDebateJob(debateJobId, controller.signal, onOpen),
      isTerminal: (event) => event.type === "done",
      onOpen: () => setSubscriptionFailure(null),
      onEvent: (event) => {
        if (event.type === "updated") {
          setSubscriptionFailure(null)
        } else if (event.type === "error") {
          setSubscriptionFailure({
            debateJobId,
            message: event.message,
          })
        }

        void queryClient.invalidateQueries({
          queryKey: debateJobQueryKey(slug),
        })
      },
      onDisconnect: (_error, willRetry) => {
        setSubscriptionFailure({
          debateJobId,
          message: willRetry
            ? "Live updates were interrupted. Reconnecting…"
            : "Live updates are unavailable. Reload the page to try again.",
        })
      },
    })

    return () => controller.abort()
  }, [debateJobId, query.data?.status, queryClient, slug])

  return {
    ...query,
    subscriptionError:
      query.data?.status === "running" &&
      debateJobId &&
      subscriptionFailure?.debateJobId === debateJobId
        ? subscriptionFailure.message
        : null,
  }
}
