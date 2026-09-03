import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AppEnv } from "../types/auth.ts"

const mocks = vi.hoisted(() => ({
  getLlmModelSettingsSnapshot: vi.fn(),
  putLlmModelSettings: vi.fn(),
}))

vi.mock("../llms/modelCatalog.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../llms/modelCatalog.ts")
  >()
  return {
    ...actual,
    getLlmModelSettingsSnapshot: mocks.getLlmModelSettingsSnapshot,
    putLlmModelSettings: mocks.putLlmModelSettings,
  }
})

import { InvalidLlmModelAssignmentError } from "../llms/modelCatalog.ts"
import { llmModelSettingsRoutes } from "./llmModelSettings.ts"

const userId = "model-settings-user"
const assignments = {
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
}
const snapshot = {
  models: [],
  availability: {
    deepseek: { status: "unavailable" as const },
    openai: { status: "disconnected" as const },
  },
  assignments,
  recommendations: assignments,
}

function createApp() {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (context, next) => {
    context.set("userId", userId)
    await next()
  })
  llmModelSettingsRoutes(app)
  return app
}

describe("LLM model settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLlmModelSettingsSnapshot.mockResolvedValue(snapshot)
    mocks.putLlmModelSettings.mockResolvedValue(snapshot)
  })

  it("returns the current user's catalog and effective assignments", async () => {
    const response = await createApp().request("/api/llm-model-settings")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(snapshot)
    expect(mocks.getLlmModelSettingsSnapshot).toHaveBeenCalledWith(userId)
  })

  it("full-replaces both assignments", async () => {
    const response = await createApp().request("/api/llm-model-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignments }),
    })

    expect(response.status).toBe(200)
    expect(mocks.putLlmModelSettings).toHaveBeenCalledWith(userId, assignments)
    await expect(response.json()).resolves.toEqual(snapshot)
  })

  it("rejects incomplete or custom request fields at the boundary", async () => {
    const response = await createApp().request("/api/llm-model-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assignments: { small: assignments.small },
        extra: true,
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.putLlmModelSettings).not.toHaveBeenCalled()
  })

  it("returns 400 when a live exact tuple is unavailable", async () => {
    mocks.putLlmModelSettings.mockRejectedValue(
      new InvalidLlmModelAssignmentError(),
    )

    const response = await createApp().request("/api/llm-model-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignments }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Selected model or reasoning effort is unavailable.",
    })
  })
})
