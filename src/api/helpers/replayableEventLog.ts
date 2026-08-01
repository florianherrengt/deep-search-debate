export interface ReplayableEventLog<Event> {
  publish(event: Event): void
  close(): void
  subscribe(): AsyncGenerator<Event>
}

/**
 * Creates an append-only event log that replays buffered events to late readers,
 * fans out live events to multiple readers, and retains data after closure.
 */
export function createReplayableEventLog<Event>(): ReplayableEventLog<Event> {
  const events: Event[] = []
  let closed = false
  let nextEventSignal = Promise.withResolvers<void>()

  return {
    publish(event) {
      if (closed) throw new Error("Cannot publish to a closed event log")
      events.push(event)

      const signal = nextEventSignal
      nextEventSignal = Promise.withResolvers<void>()
      signal.resolve()
    },
    close() {
      if (closed) return
      closed = true
      nextEventSignal.resolve()
    },
    async *subscribe() {
      let cursor = 0

      while (true) {
        if (cursor < events.length) {
          yield events[cursor++]
          continue
        }

        if (closed) return
        await nextEventSignal.promise
      }
    },
  }
}
