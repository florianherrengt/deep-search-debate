import { describe, expect, it } from "vitest"
import { createReplayableEventLog } from "./replayableEventLog.ts"

async function collect<Event>(source: AsyncIterable<Event>): Promise<Event[]> {
  const events: Event[] = []
  for await (const event of source) events.push(event)
  return events
}

describe("createReplayableEventLog", () => {
  it("replays buffered events after the log closes", async () => {
    const log = createReplayableEventLog<string>()
    log.publish("first")
    log.publish("second")
    log.close()

    await expect(collect(log.subscribe())).resolves.toEqual([
      "first",
      "second",
    ])
  })

  it("fans live events out to multiple subscribers", async () => {
    const log = createReplayableEventLog<string>()
    const first = collect(log.subscribe())
    const second = collect(log.subscribe())

    log.publish("event")
    log.close()

    await expect(first).resolves.toEqual(["event"])
    await expect(second).resolves.toEqual(["event"])
  })
})
