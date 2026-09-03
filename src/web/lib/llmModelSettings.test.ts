import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getLlmModelSettings,
  llmModelSettingsSchema,
  updateLlmModelSettings,
} from "./llmModelSettings.ts"

const response = {
  models: [
    {
      provider: "deepseek" as const,
      providerLabel: "DeepSeek" as const,
      modelId: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      description: "Fast model",
      reasoningEfforts: ["low", "medium"] as const,
    },
    {
      provider: "openai" as const,
      providerLabel: "OpenAI" as const,
      modelId: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      reasoningEfforts: ["high", "xhigh"] as const,
    },
  ],
  availability: {
    deepseek: { status: "available" as const },
    openai: { status: "available" as const },
  },
  assignments: {
    small: {
      provider: "deepseek" as const,
      modelId: "deepseek-v4-flash",
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
      provider: "deepseek" as const,
      modelId: "deepseek-v4-flash",
      reasoningEffort: "medium" as const,
    },
    big: {
      provider: "openai" as const,
      modelId: "gpt-5.6-sol",
      reasoningEffort: "xhigh" as const,
    },
  },
}

describe("LLM model settings API", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("validates provider-labelled models and supported reasoning efforts", () => {
    expect(llmModelSettingsSchema.parse(response)).toEqual(response)
    expect(
      llmModelSettingsSchema.safeParse({
        ...response,
        assignments: {
          ...response.assignments,
          big: {
            ...response.assignments.big,
            reasoningEffort: "extreme",
          },
        },
      }).success,
    ).toBe(false)
  })

  it("loads and replaces both assignments through the authenticated endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json(response)),
    )
    vi.stubGlobal("fetch", fetchMock)
    const signal = new AbortController().signal

    await expect(getLlmModelSettings(signal)).resolves.toEqual(response)
    await expect(
      updateLlmModelSettings(response.assignments),
    ).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/llm-model-settings", {
      signal,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/llm-model-settings", {
      body: JSON.stringify({ assignments: response.assignments }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      signal: undefined,
    })
  })
})
