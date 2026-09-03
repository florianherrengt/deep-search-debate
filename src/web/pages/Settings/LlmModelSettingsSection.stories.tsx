import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"

import { ApiError } from "../../lib/api.ts"
import type { LlmModelSettings } from "../../lib/llmModelSettings.ts"
import {
  LlmModelSettingsSection,
  type LlmModelSettingsServices,
} from "./LlmModelSettingsSection.tsx"

const recommendedSettings = {
  models: [
    {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      modelId: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      description: "Fast for focused tasks.",
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      modelId: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      description: "Strong for complex work.",
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    {
      provider: "openai",
      providerLabel: "OpenAI",
      modelId: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      description: "A quick OpenAI model for focused tasks.",
      reasoningEfforts: ["low", "medium", "high"],
    },
    {
      provider: "openai",
      providerLabel: "OpenAI",
      modelId: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      description: "A capable OpenAI model for complex work.",
      reasoningEfforts: ["medium", "high", "xhigh"],
    },
  ],
  availability: {
    deepseek: { status: "available" },
    openai: { status: "available" },
  },
  assignments: {
    small: {
      provider: "openai",
      modelId: "gpt-5.6-luna",
      reasoningEffort: "medium",
    },
    big: {
      provider: "openai",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    },
  },
  recommendations: {
    small: {
      provider: "openai",
      modelId: "gpt-5.6-luna",
      reasoningEffort: "medium",
    },
    big: {
      provider: "openai",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    },
  },
} satisfies LlmModelSettings

function servicesFor(
  settings: LlmModelSettings,
): LlmModelSettingsServices {
  return {
    getSettings: () => Promise.resolve(settings),
    updateSettings: (assignments) =>
      Promise.resolve({ ...settings, assignments }),
  }
}

const meta = {
  title: "Pages/Settings/Model choices",
  component: LlmModelSettingsSection,
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
        <Story />
      </Container>
    ),
  ],
  args: { services: servicesFor(recommendedSettings) },
} satisfies Meta<typeof LlmModelSettingsSection>

export default meta
type Story = StoryObj<typeof meta>

export const Recommended: Story = {}

export const Loading: Story = {
  args: {
    services: {
      getSettings: () => new Promise(() => undefined),
      updateSettings: servicesFor(recommendedSettings).updateSettings,
    },
  },
}

export const ProvidersUnavailable: Story = {
  args: {
    services: servicesFor({
      ...recommendedSettings,
      models: [],
      availability: {
        deepseek: {
          status: "unavailable",
          message: "DeepSeek models could not be loaded.",
        },
        openai: {
          status: "unavailable",
          message: "OpenAI models could not be loaded.",
        },
      },
    }),
  },
}

export const FailedToLoad: Story = {
  args: {
    services: {
      getSettings: () =>
        Promise.reject(
          new ApiError("GET", "/api/llm-model-settings", 400),
        ),
      updateSettings: servicesFor(recommendedSettings).updateSettings,
    },
  },
}

export const NarrowScreen: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
}
