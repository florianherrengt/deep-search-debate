import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteOpenAiConnection: vi.fn(),
  getOpenAiConnection: vi.fn(),
  getLlmModelSettings: vi.fn(),
  startOpenAiConnection: vi.fn(),
  updateLlmModelSettings: vi.fn(),
}))

vi.mock("../../lib/openAiConnection.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/openAiConnection.ts")>()),
  deleteOpenAiConnection: mocks.deleteOpenAiConnection,
  getOpenAiConnection: mocks.getOpenAiConnection,
  startOpenAiConnection: mocks.startOpenAiConnection,
}))

vi.mock("../../lib/llmModelSettings.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llmModelSettings.ts")>()),
  getLlmModelSettings: mocks.getLlmModelSettings,
  updateLlmModelSettings: mocks.updateLlmModelSettings,
}))

import { openAiConnectionQueryKey } from "../../lib/openAiConnection.ts"
import { Settings } from "./Settings.tsx"

const deepSeekSettings = {
  models: [
    {
      provider: "deepseek" as const,
      providerLabel: "DeepSeek" as const,
      modelId: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      description: "Fast for focused tasks.",
      reasoningEfforts: ["low", "medium", "high"] as const,
    },
    {
      provider: "deepseek" as const,
      providerLabel: "DeepSeek" as const,
      modelId: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      description: "Strong for complex work.",
      reasoningEfforts: ["medium", "high", "xhigh"] as const,
    },
  ],
  availability: {
    deepseek: { status: "available" as const },
    openai: {
      status: "disconnected" as const,
      message: "Connect OpenAI to use its models.",
    },
  },
  assignments: {
    small: {
      provider: "deepseek" as const,
      modelId: "deepseek-v4-flash",
      reasoningEffort: "medium" as const,
    },
    big: {
      provider: "deepseek" as const,
      modelId: "deepseek-v4-pro",
      reasoningEffort: "xhigh" as const,
    },
  },
  recommendations: {
    small: {
      provider: "deepseek" as const,
      modelId: "deepseek-v4-flash",
      reasoningEffort: "medium" as const,
    },
    big: {
      provider: "deepseek" as const,
      modelId: "deepseek-v4-pro",
      reasoningEffort: "xhigh" as const,
    },
  },
}

const connectedSettings = {
  ...deepSeekSettings,
  models: [
    ...deepSeekSettings.models,
    {
      provider: "openai" as const,
      providerLabel: "OpenAI" as const,
      modelId: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      description: "Quick OpenAI model.",
      reasoningEfforts: ["low", "medium", "high"] as const,
    },
    {
      provider: "openai" as const,
      providerLabel: "OpenAI" as const,
      modelId: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      description: "Most capable OpenAI model.",
      reasoningEfforts: ["high", "xhigh"] as const,
    },
  ],
  availability: {
    deepseek: { status: "available" as const },
    openai: { status: "available" as const },
  },
  assignments: {
    small: {
      provider: "openai" as const,
      modelId: "gpt-5.6-luna",
      reasoningEffort: "medium" as const,
    },
    big: {
      provider: "openai" as const,
      modelId: "gpt-5.6-sol",
      reasoningEffort: "xhigh" as const,
    },
  },
  recommendations: {
    small: {
      provider: "openai" as const,
      modelId: "gpt-5.6-luna",
      reasoningEffort: "medium" as const,
    },
    big: {
      provider: "openai" as const,
      modelId: "gpt-5.6-sol",
      reasoningEffort: "xhigh" as const,
    },
  },
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Settings />
      </QueryClientProvider>,
    ),
    queryClient,
  }
}

async function choose(label: string, optionName: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }))
  fireEvent.click(await screen.findByRole("option", { name: optionName }))
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteOpenAiConnection.mockResolvedValue({ status: "disconnected" })
    mocks.getOpenAiConnection.mockResolvedValue({ status: "disconnected" })
    mocks.getLlmModelSettings.mockResolvedValue(deepSeekSettings)
    mocks.startOpenAiConnection.mockResolvedValue({
      status: "pending",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-25T12:00:00.000Z",
    })
    mocks.updateLlmModelSettings.mockResolvedValue(deepSeekSettings)
    document.title = "Public page — RethinkLoop"
  })

  it("starts device authentication and lets the user cancel it", async () => {
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
    document.head
      .querySelectorAll('meta[name="robots"]')
      .forEach((node) => node.remove())
    const robots = document.createElement("meta")
    robots.name = "robots"
    robots.content = "index, follow"
    document.head.append(robots)
    const canonical = document.createElement("link")
    canonical.rel = "canonical"
    canonical.href = "https://rethinkloop.com/examples"
    document.head.append(canonical)
    const structuredData = document.createElement("script")
    structuredData.type = "application/ld+json"
    structuredData.dataset.seoJsonLd = "true"
    structuredData.textContent = '{"@type":"Article"}'
    document.head.append(structuredData)
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

  it("shows the recommended provider-labelled Small and Big defaults", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "connected" })
    mocks.getLlmModelSettings.mockResolvedValue(connectedSettings)
    renderSettings()

    expect(
      await screen.findByRole("heading", { name: "Models" }),
    ).toBeVisible()
    await screen.findByRole("combobox", { name: "Small model" })
    expect(
      screen.getByText("Used for summaries, filtering, and titles."),
    ).toBeVisible()
    expect(
      screen.getByText("Used for planning, synthesis, ideas, and debates."),
    ).toBeVisible()
    expect(
      screen.getByRole("combobox", { name: "Small model" }),
    ).toHaveTextContent("GPT-5.6 Luna — OpenAI (Recommended)")
    expect(
      screen.getByRole("combobox", { name: "Big model" }),
    ).toHaveTextContent("GPT-5.6 Sol — OpenAI (Recommended)")
    expect(
      screen.getByRole("combobox", { name: "Small reasoning" }),
    ).toHaveTextContent("Medium (Recommended)")
    expect(
      screen.getByRole("combobox", { name: "Big reasoning" }),
    ).toHaveTextContent("Extra high (Recommended)")

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Small model" }))
    expect(
      screen.getByRole("option", {
        name: "GPT-5.6 Luna — OpenAI (Recommended)",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("option", { name: "DeepSeek V4 Flash — DeepSeek" }),
    ).toBeVisible()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
  })

  it("saves changed models and reasoning for both roles atomically", async () => {
    const savedSettings = {
      ...connectedSettings,
      assignments: {
        small: {
          provider: "deepseek" as const,
          modelId: "deepseek-v4-pro",
          reasoningEffort: "high" as const,
        },
        big: {
          provider: "openai" as const,
          modelId: "gpt-5.6-luna",
          reasoningEffort: "low" as const,
        },
      },
    }
    mocks.getOpenAiConnection.mockResolvedValue({ status: "connected" })
    mocks.getLlmModelSettings.mockResolvedValue(connectedSettings)
    mocks.updateLlmModelSettings.mockResolvedValue(savedSettings)
    renderSettings()

    await screen.findByRole("combobox", { name: "Small model" })
    await choose("Small model", "DeepSeek V4 Pro — DeepSeek")
    await choose("Small reasoning", "High")
    await choose("Big model", "GPT-5.6 Luna — OpenAI")
    await choose("Big reasoning", "Low")
    fireEvent.click(screen.getByRole("button", { name: "Save model choices" }))

    await waitFor(() =>
      expect(mocks.updateLlmModelSettings).toHaveBeenCalledOnce(),
    )
    expect(mocks.updateLlmModelSettings.mock.calls[0]?.[0]).toEqual({
      small: {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoningEffort: "high",
      },
      big: {
        provider: "openai",
        modelId: "gpt-5.6-luna",
        reasoningEffort: "low",
      },
    })
    expect(await screen.findByText("Model choices saved.")).toBeVisible()
  })

  it("preserves edited choices when saving fails", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "connected" })
    mocks.getLlmModelSettings.mockResolvedValue(connectedSettings)
    mocks.updateLlmModelSettings.mockRejectedValue(new Error("offline"))
    renderSettings()

    await screen.findByRole("combobox", { name: "Small model" })
    await choose("Small model", "DeepSeek V4 Pro — DeepSeek")
    await choose("Small reasoning", "High")
    fireEvent.click(screen.getByRole("button", { name: "Save model choices" }))

    expect(
      await screen.findByText(
        "Could not connect to the server. Check your connection and try again.",
      ),
    ).toBeVisible()
    expect(
      screen.getByRole("combobox", { name: "Small model" }),
    ).toHaveTextContent("DeepSeek V4 Pro — DeepSeek")
    expect(
      screen.getByRole("combobox", { name: "Small reasoning" }),
    ).toHaveTextContent("High")
  })

  it("refreshes model choices after OpenAI disconnects and applies the reset", async () => {
    mocks.getOpenAiConnection.mockResolvedValue({ status: "connected" })
    mocks.getLlmModelSettings
      .mockResolvedValueOnce(connectedSettings)
      .mockResolvedValue(deepSeekSettings)
    renderSettings()

    expect(
      await screen.findByRole("combobox", { name: "Small model" }),
    ).toHaveTextContent("GPT-5.6 Luna")
    fireEvent.click(screen.getByRole("button", { name: "Disconnect OpenAI" }))
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Disconnect OpenAI?" }),
      ).getByRole("button", { name: "Disconnect" }),
    )

    await waitFor(() =>
      expect(mocks.getLlmModelSettings.mock.calls.length).toBeGreaterThan(1),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Small model" }),
      ).toHaveTextContent("DeepSeek V4 Flash"),
    )
    expect(
      screen.getByRole("combobox", { name: "Big model" }),
    ).toHaveTextContent("DeepSeek V4 Pro")
  })

  it("refreshes available models when an OpenAI connection completes", async () => {
    const { queryClient } = renderSettings()

    await screen.findByRole("combobox", { name: "Small model" })
    mocks.getLlmModelSettings.mockResolvedValue(connectedSettings)
    queryClient.setQueryData(openAiConnectionQueryKey, { status: "connected" })

    await waitFor(() =>
      expect(mocks.getLlmModelSettings.mock.calls.length).toBeGreaterThan(1),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Small model" }),
      ).toHaveTextContent("GPT-5.6 Luna"),
    )
  })

  it("explains an empty provider result and lets the user refresh it", async () => {
    mocks.getLlmModelSettings.mockResolvedValue({
      ...deepSeekSettings,
      models: [],
      availability: {
        deepseek: {
          status: "unavailable",
          message: "DeepSeek could not be reached.",
        },
        openai: deepSeekSettings.availability.openai,
      },
    })
    renderSettings()

    expect(
      await screen.findByText("DeepSeek could not be reached."),
    ).toBeVisible()
    expect(
      screen.getByText(
        "No models are available right now. Check the provider messages above and refresh the list.",
      ),
    ).toBeVisible()
    mocks.getLlmModelSettings.mockResolvedValue(deepSeekSettings)
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }))

    await waitFor(() =>
      expect(mocks.getLlmModelSettings.mock.calls.length).toBeGreaterThan(1),
    )
    expect(
      await screen.findByRole("combobox", { name: "Small model" }),
    ).toHaveTextContent("DeepSeek V4 Flash")
  })
})
