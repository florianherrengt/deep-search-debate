import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { creditAccountQueryKey } from "../../lib/credits.ts"

const mocks = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
  grantUserCredits: vi.fn(),
}))

vi.mock("../../lib/credits.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/credits.ts")>()),
  getAdminUsers: mocks.getAdminUsers,
  grantUserCredits: mocks.grantUserCredits,
}))

import { AdminCredits } from "./AdminCredits.tsx"

function renderAdminCredits() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <AdminCredits />
      </QueryClientProvider>,
    ),
    queryClient,
  }
}

describe("AdminCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminUsers.mockResolvedValue({
      users: [
        {
          credits: 1_000,
          email: "admin@example.com",
          id: "admin-user-id",
          isAdmin: true,
          name: "Admin User",
        },
      ],
    })
    mocks.grantUserCredits.mockResolvedValue({ credits: 2_000 })
  })

  it("replaces public resource metadata with private admin metadata", async () => {
    document.title = "Public debate — RethinkLoop"
    document.documentElement.dataset.seoPage = "/debates/public-debate"
    document.head.innerHTML = `
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://rethinkloop.com/debates/public-debate" />
      <script type="application/ld+json" data-seo-json-ld="true">{"@type":"Article"}</script>
    `
    renderAdminCredits()

    await waitFor(() =>
      expect(document.title).toBe("Admin Credits — RethinkLoop"),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toBeNull()
    expect(document.documentElement.dataset.seoPage).toBe("/admin/credits")
  })

  it("grants the entered credits to the chosen user and refreshes balances", async () => {
    const admin = {
      credits: 1_000,
      email: "admin@example.com",
      id: "admin-user-id",
      isAdmin: true,
      name: "Admin User",
    }
    const member = {
      credits: 25,
      email: "member@example.com",
      id: "member-user-id",
      isAdmin: false,
      name: "Member User",
    }
    mocks.getAdminUsers.mockResolvedValueOnce({ users: [admin, member] })
    mocks.getAdminUsers.mockResolvedValue({
      users: [admin, { ...member, credits: 75 }],
    })
    const { queryClient } = renderAdminCredits()
    queryClient.setQueryData(creditAccountQueryKey, {
      credits: 1_000,
      isAdmin: true,
    })

    expect(
      within(await screen.findByRole("row", { name: /Member User/ })).getByText(
        "25",
      ),
    ).toBeVisible()
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "User" }))
    fireEvent.click(
      await screen.findByRole("option", { name: "member@example.com" }),
    )
    fireEvent.change(screen.getByRole("spinbutton", { name: "Credits to add" }), {
      target: { value: "50" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }))

    await waitFor(() =>
      expect(mocks.grantUserCredits.mock.calls[0]?.[0]).toEqual({
        userId: "member-user-id",
        credits: 50,
      }),
    )
    expect(await screen.findByText("Credits added successfully.")).toBeVisible()
    expect(
      within(screen.getByRole("row", { name: /Member User/ })).getByText("75"),
    ).toBeVisible()
    expect(queryClient.getQueryState(creditAccountQueryKey)?.isInvalidated).toBe(
      true,
    )
  })

  it.each(["0", "-1", "1.5", "100000001"])(
    "blocks an invalid grant amount of %s",
    async (amount) => {
      renderAdminCredits()
      await screen.findByRole("row", { name: /Admin User/ })

      fireEvent.change(
        screen.getByRole("spinbutton", { name: "Credits to add" }),
        { target: { value: amount } },
      )

      expect(screen.getByRole("button", { name: "Add credits" })).toBeDisabled()
      expect(mocks.grantUserCredits).not.toHaveBeenCalled()
    },
  )

  it("shows a failed grant and keeps the entered amount available to retry", async () => {
    mocks.grantUserCredits.mockRejectedValueOnce(new Error("Network unavailable"))
    renderAdminCredits()
    await screen.findByRole("row", { name: /Admin User/ })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Credits to add" }), {
      target: { value: "250" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Add credits" }))

    expect(
      await screen.findByText(
        "Could not connect to the server. Check your connection and try again.",
      ),
    ).toBeVisible()
    expect(screen.getByRole("spinbutton", { name: "Credits to add" })).toHaveValue(
      250,
    )
    expect(screen.queryByText("Credits added successfully.")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Add credits" }))

    expect(await screen.findByText("Credits added successfully.")).toBeVisible()
    expect(
      screen.queryByText(
        "Could not connect to the server. Check your connection and try again.",
      ),
    ).toBeNull()
    expect(mocks.grantUserCredits.mock.calls[1]?.[0]).toEqual({
      userId: "admin-user-id",
      credits: 250,
    })
  })
})
