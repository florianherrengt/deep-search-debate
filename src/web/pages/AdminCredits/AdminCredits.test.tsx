import { render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
}))

vi.mock("../../lib/credits.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/credits.ts")>()),
  getAdminUsers: mocks.getAdminUsers,
}))

import { AdminCredits } from "./AdminCredits.tsx"

function renderAdminCredits() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCredits />
    </QueryClientProvider>,
  )
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

    document.title = "Public debate — RethinkLoop"
    document.documentElement.dataset.seoPage = "/debates/public-debate"
    document.head.innerHTML = `
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://rethinkloop.com/debates/public-debate" />
      <script type="application/ld+json" data-seo-json-ld="true">{"@type":"Article"}</script>
    `
  })

  it("replaces public resource metadata with private admin metadata", async () => {
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
})
