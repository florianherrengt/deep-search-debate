import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getExampleDebates: vi.fn(),
}))

vi.mock("../../lib/examples.ts", () => ({
  getExampleDebates: mocks.getExampleDebates,
}))

import { Examples } from "./index.tsx"

function renderExamples() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Examples />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Examples", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getExampleDebates.mockResolvedValue([])
  })

  it("renders curated debates in API order with detail links", async () => {
    mocks.getExampleDebates.mockResolvedValue([
      {
        debateJobId: "22222222-2222-4222-8222-222222222222",
        prompt: "Second prompt",
        slug: "second-example",
        title: "Second example",
      },
      {
        debateJobId: "11111111-1111-4111-8111-111111111111",
        prompt: "First prompt",
        slug: "first/example",
        title: "First example",
      },
    ])

    renderExamples()

    const articles = await screen.findAllByRole("article")
    expect(articles).toHaveLength(2)
    expect(
      within(articles[0]).getByRole("heading", { name: "Second example" }),
    ).toBeVisible()
    expect(
      within(articles[1]).getByRole("link", { name: "View debate" }),
    ).toHaveAttribute("href", "/debates/first%2Fexample")
    expect(document.title).toBe("Examples — RethinkLoop")
  })

  it("renders a clear empty state", async () => {
    renderExamples()

    expect(
      await screen.findByText("No examples are currently published."),
    ).toBeVisible()
  })
})
