import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteOpenAiConnection: vi.fn(),
  getOpenAiConnection: vi.fn(),
  startOpenAiConnection: vi.fn(),
}))

vi.mock("../../lib/openAiConnection.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/openAiConnection.ts")>()),
  deleteOpenAiConnection: mocks.deleteOpenAiConnection,
  getOpenAiConnection: mocks.getOpenAiConnection,
  startOpenAiConnection: mocks.startOpenAiConnection,
}))

import { Settings } from "./Settings.tsx"

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Settings />
    </QueryClientProvider>,
  )
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteOpenAiConnection.mockResolvedValue({ status: "disconnected" })
    mocks.startOpenAiConnection.mockResolvedValue({
      status: "pending",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-25T12:00:00.000Z",
    })
    document.title = "Public page — RethinkLoop"
    document.head.innerHTML = `
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href="https://rethinkloop.com/examples" />
      <script type="application/ld+json" data-seo-json-ld="true">{"@type":"Article"}</script>
    `
  })

  it("starts device authentication and lets the user cancel it", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "disconnected" })
    renderSettings()

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect OpenAI" }),
    )

    expect(
      await screen.findByRole("heading", {
        name: "Finish connecting with OpenAI",
      }),
    ).toBeVisible()
    expect(screen.getByText("ABCD-EFGH")).toBeVisible()
    expect(
      screen.getByRole("link", { name: /Open OpenAI verification/i }),
    ).toHaveAttribute("href", "https://auth.openai.com/device")
    expect(
      screen.getByRole("link", { name: /Open OpenAI verification/i }),
    ).toHaveAttribute("target", "_blank")
    expect(mocks.startOpenAiConnection).toHaveBeenCalledOnce()

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel connection" }),
    )

    await waitFor(() =>
      expect(mocks.deleteOpenAiConnection).toHaveBeenCalledOnce(),
    )
    expect(
      await screen.findByRole("button", { name: "Connect OpenAI" }),
    ).toBeVisible()
  })

  it("requires confirmation before disconnecting a connected account", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "connected" })
    renderSettings()

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect OpenAI" }),
    )

    expect(
      screen.getByRole("dialog", { name: "Disconnect OpenAI?" }),
    ).toBeVisible()
    expect(mocks.deleteOpenAiConnection).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))

    await waitFor(() =>
      expect(mocks.deleteOpenAiConnection).toHaveBeenCalledOnce(),
    )
    expect(
      await screen.findByRole("button", { name: "Connect OpenAI" }),
    ).toBeVisible()
  })

  it("shows a saved failure and can restart authentication", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({
      status: "failed",
      message: "Your OpenAI connection expired. Connect it again.",
    })
    renderSettings()

    expect(
      await screen.findByText(
        "Your OpenAI connection expired. Connect it again.",
      ),
    ).toBeVisible()

    fireEvent.click(
      screen.getByRole("button", { name: "Retry connection" }),
    )

    expect(await screen.findByText("ABCD-EFGH")).toBeVisible()
    expect(mocks.startOpenAiConnection).toHaveBeenCalledOnce()
  })

  it("replaces public metadata with private settings metadata", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "disconnected" })
    renderSettings()

    await waitFor(() => expect(document.title).toBe("Settings — RethinkLoop"))
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toBeNull()
    expect(document.documentElement.dataset.seoPage).toBe("/settings")
  })
})
