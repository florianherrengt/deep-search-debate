import { describe, expect, it } from "vitest"
import { subscribeToStoryStream } from "./DeepSearchView.fixture.ts"

describe("DeepSearchView Storybook fixture", () => {
  it.each([
    ["failed-query-summary", "Query summary generation failed"],
    ["round-review-failed", "Round review generation failed"],
  ])("terminates the failed %s stream", async (streamId, message) => {
    const events = []

    for await (const event of subscribeToStoryStream(streamId)) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "error", message },
      { type: "done" },
    ])
  })
})
