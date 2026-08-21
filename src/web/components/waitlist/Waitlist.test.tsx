import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import { JoinWaitlistButton, WaitlistForm } from "./Waitlist.tsx"

function renderWaitlist(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

it("collects a valid email from the waitlist dialog", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ joined: true }))
  vi.stubGlobal("fetch", fetchMock)
  renderWaitlist(<JoinWaitlistButton />)

  fireEvent.click(screen.getByRole("button", { name: "Join the waiting list" }))

  expect(
    screen.getByRole("dialog", { name: "Join the waiting list" }),
  ).toBeVisible()
  const submit = screen.getByRole("button", { name: "Join waiting list" })
  expect(submit).toBeDisabled()

  fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
    target: { value: "invalid" },
  })
  expect(screen.getByText("Enter a valid email address.")).toBeVisible()

  fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
    target: { value: "person@example.com" },
  })
  fireEvent.click(submit)

  expect(
    await screen.findByText(/you’re on the waiting list/i),
  ).toBeVisible()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it("keeps the submitted email available after a server error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  )
  renderWaitlist(<WaitlistForm />)

  const email = screen.getByRole("textbox", { name: "Email address" })
  fireEvent.change(email, { target: { value: "person@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "Join waiting list" }))

  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible())
  expect(email).toHaveValue("person@example.com")
})
