import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  hasOpenAiCodexConnection: vi.fn(),
  listAvailableCodexModels: vi.fn(),
}))

vi.mock("../openaiConnection/codexGeneration.ts", () => ({
  listAvailableCodexModels: mocks.listAvailableCodexModels,
}))

vi.mock("../openaiConnection/credentialsRepository.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../openaiConnection/credentialsRepository.ts")
  >()
  return {
    ...actual,
    hasOpenAiCodexConnection: mocks.hasOpenAiCodexConnection,
  }
})

import { db } from "../db/index.ts"
import {
  llmModelSettings,
  openAiCodexConnections,
} from "../db/schema/index.ts"
import {
  getLlmModelSettingsSnapshot,
  InvalidLlmModelAssignmentError,
  putLlmModelSettings,
} from "./modelCatalog.ts"
import { deepSeekRecommendedAssignments } from "./modelSettings.ts"

const userId = "test-user-id"
const originalFetch = globalThis.fetch

function mockDeepSeekModels(...modelIds: string[]): void {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          object: "list",
          data: modelIds.map((id) => ({ id, object: "model" })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  )
}

function insertConnection(): void {
  db.insert(openAiCodexConnections)
    .values({
      userId,
      connectionId: crypto.randomUUID(),
      credentialsCiphertext: Buffer.from("ciphertext"),
      credentialsNonce: Buffer.alloc(12),
      credentialsAuthenticationTag: Buffer.alloc(16),
    })
    .run()
}

beforeEach(() => {
  vi.clearAllMocks()
  db.delete(llmModelSettings).run()
  db.delete(openAiCodexConnections).run()
  mocks.hasOpenAiCodexConnection.mockReturnValue(false)
  mocks.listAvailableCodexModels.mockResolvedValue(undefined)
  mockDeepSeekModels(
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "unsupported-vision-model",
  )
})

afterEach(() => {
  globalThis.fetch = originalFetch
  db.delete(llmModelSettings).run()
  db.delete(openAiCodexConnections).run()
})

describe("LLM model catalog", () => {
  it("returns only priced DeepSeek models and DeepSeek recommendations", async () => {
    const snapshot = await getLlmModelSettingsSnapshot(userId)

    expect(snapshot.models.map((model) => model.modelId)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ])
    expect(snapshot.availability).toEqual({
      deepseek: { status: "available" },
      openai: { status: "disconnected" },
    })
    expect(snapshot.assignments).toEqual(deepSeekRecommendedAssignments)
    expect(snapshot.recommendations).toEqual(deepSeekRecommendedAssignments)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        headers: { authorization: "Bearer test-key" },
      }),
    )
  })

  it("recommends the exact preferred OpenAI models only when each effort is advertised", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    mocks.listAvailableCodexModels.mockResolvedValue([
      {
        id: "gpt-5.6-luna",
        displayName: "Luna",
        description: "Fast model",
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
        ],
      },
      {
        id: "gpt-5.6-sol",
        displayName: "Sol",
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
        ],
      },
    ])

    const snapshot = await getLlmModelSettingsSnapshot(userId)

    expect(snapshot.recommendations).toEqual({
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
    })
    expect(snapshot.models).toContainEqual({
      provider: "openai",
      providerLabel: "OpenAI",
      modelId: "gpt-5.6-luna",
      label: "Luna",
      description: "Fast model",
      reasoningEfforts: ["low", "medium"],
    })
  })

  it("keeps Settings responsive when OpenAI model discovery stalls", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    const controller = new AbortController()
    const requestedTimeouts: number[] = []
    let receivedSignal: AbortSignal | undefined
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      requestedTimeouts.push(ms)
      return controller.signal
    })
    mocks.listAvailableCodexModels.mockImplementation(
      (_userId: string, signal?: AbortSignal) => {
        receivedSignal = signal
        return new Promise<never>((_resolve, reject) => {
          if (!signal) return
          signal.addEventListener("abort", () => reject(new Error("Model discovery aborted")), {
            once: true,
          })
        })
      },
    )

    try {
      const snapshotPromise = getLlmModelSettingsSnapshot(userId)
      expect(receivedSignal).toBeInstanceOf(AbortSignal)
      controller.abort(new DOMException("Discovery timed out", "TimeoutError"))
      const snapshot = await snapshotPromise

      expect(snapshot.models.map((model) => model.modelId)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ])
      expect(snapshot.availability.openai).toEqual({
        status: "unavailable",
        message: "Could not load OpenAI models.",
      })
      expect(requestedTimeouts.some((ms) => ms > 0 && ms < 125_000)).toBe(true)
    } finally {
      timeoutSpy.mockRestore()
    }
  }, 1_500)

  it("bounds Settings discovery even when the OpenAI request ignores abort", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    let rejectCatalog: ((error: Error) => void) | undefined
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    mocks.listAvailableCodexModels.mockImplementation(
      (_userId: string, signal?: AbortSignal) => {
        receivedSignal = signal
        return new Promise<never>((_resolve, reject) => {
          rejectCatalog = reject
        })
      },
    )
    const snapshotPromise = getLlmModelSettingsSnapshot(userId)

    try {
      expect(receivedSignal).toBeInstanceOf(AbortSignal)
      controller.abort(new DOMException("Discovery timed out", "TimeoutError"))
      expect(receivedSignal?.aborted).toBe(true)

      const result = await Promise.race([
        snapshotPromise.then((snapshot) => ({ status: "resolved" as const, snapshot })),
        new Promise<{ status: "pending" }>((resolve) => {
          setImmediate(() => resolve({ status: "pending" }))
        }),
      ])
      expect(result.status).toBe("resolved")
      const snapshot = result.status === "resolved" ? result.snapshot : undefined
      expect(snapshot?.models.map((model) => model.modelId)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ])
      expect(snapshot?.availability.openai).toEqual({
        status: "unavailable",
        message: "Could not load OpenAI models.",
      })
    } finally {
      rejectCatalog?.(new Error("Release stalled model discovery"))
      await snapshotPromise.catch(() => undefined)
      timeoutSpy.mockRestore()
    }
  }, 1_500)

  it("validates both exact assignments before atomically replacing settings", async () => {
    insertConnection()
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    mocks.listAvailableCodexModels.mockResolvedValue([
      {
        id: "gpt-custom",
        displayName: "Custom",
        isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ])

    const assignments = {
      small: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-flash",
        reasoningEffort: "none" as const,
      },
      big: {
        provider: "openai" as const,
        modelId: "gpt-custom",
        reasoningEffort: "high" as const,
      },
    }
    const snapshot = await putLlmModelSettings(userId, assignments)
    expect(snapshot.assignments).toEqual(assignments)

    await expect(
      putLlmModelSettings(userId, {
        ...assignments,
        big: { ...assignments.big, reasoningEffort: "xhigh" },
      }),
    ).rejects.toBeInstanceOf(InvalidLlmModelAssignmentError)
    expect((await getLlmModelSettingsSnapshot(userId)).assignments).toEqual(
      assignments,
    )
  })

  it("returns bounded safe availability errors without exposing provider text", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("upstream-secret", { status: 503 })),
    )
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    mocks.listAvailableCodexModels.mockRejectedValue(
      new Error("bearer upstream-secret"),
    )

    const snapshot = await getLlmModelSettingsSnapshot(userId)

    expect(snapshot.models).toEqual([])
    expect(snapshot.availability).toEqual({
      deepseek: {
        status: "unavailable",
        message: "Could not load DeepSeek models.",
      },
      openai: {
        status: "unavailable",
        message: "Could not load OpenAI models.",
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain("upstream-secret")
  })
})
