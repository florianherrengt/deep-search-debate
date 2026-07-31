import { expect, test } from "@playwright/test"

type TextStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" }

function parseEvents(body: string): TextStreamEvent[] {
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TextStreamEvent)
}

// This exercises the real stack end-to-end: browser, Vite proxy, API stream
// registry, and a real DeepSeek call. Nothing on the network path is mocked.
test.describe("Chat streaming", () => {
  test("follows a real LLM stream and can replay it", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    await page.goto("/chat")

    const prompt = "Say hi in one short sentence."
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/streams",
    )
    const liveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/api\/streams\/[^/]+$/.test(new URL(response.url()).pathname),
    )

    const composer = page.getByPlaceholder("Ask something...")
    await composer.fill(prompt)
    await composer.press("Enter")

    const created = await createdResponse
    expect(created.status()).toBe(201)
    expect(created.request().postDataJSON()).toEqual({
      prompt,
      promptName: "default",
    })

    const body = (await created.json()) as { id: string }
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(created.headers()["location"]).toBe(`/api/streams/${body.id}`)

    const live = await liveResponse
    expect(new URL(live.url()).pathname).toBe(`/api/streams/${body.id}`)
    expect(live.status()).toBe(200)
    expect(live.headers()["content-type"]).toContain("application/x-ndjson")

    await expect(composer).toBeEnabled({ timeout: 90_000 })

    const liveEvents = parseEvents(await live.text())
    expect(liveEvents.at(-1)).toEqual({ type: "done" })
    expect(liveEvents.some((event) => event.type === "error")).toBe(false)

    const answer = liveEvents
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(answer.trim()).not.toBe("")

    const reply = page
      .locator(".MuiPaper-root")
      .filter({ hasText: "DeepSeek" })
      .locator("p")
      .last()
    await expect(reply).toHaveText(answer)

    const replay = await request.get(`/api/streams/${body.id}`)
    expect(replay.status()).toBe(200)
    expect(replay.headers()["content-type"]).toContain(
      "application/x-ndjson",
    )
    expect(parseEvents(await replay.text())).toEqual(liveEvents)
  })
})
