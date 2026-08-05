import { describe, expect, it } from "vitest"
import { subscribeToStoryStream } from "./DeepSearchView.fixture.ts"

describe("DeepSearchView Storybook fixture", () => {
  it("terminates the failed query-summary stream", async () => {
    const events = []

    for await (const event of subscribeToStoryStream("failed-query-summary")) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "error", message: "Query summary generation failed" },
      { type: "done" },
    ])
  })
})
