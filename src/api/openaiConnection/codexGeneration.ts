import {
  createModels,
  getSupportedThinkingLevels,
  hasApi,
  type Api,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"

import { config } from "../config.ts"
import {
  llmReasoningEffortSchema,
  type LlmReasoningEffort,
} from "../llms/modelSettings.ts"
import {
  startPiLlmStream,
  type PiLlmRequest,
} from "../llms/piGeneration.ts"
import type { StartedLlmStream } from "../llms/streamTypes.ts"
import { classifyCodexError, OpenAiCodexError } from "./codexErrors.ts"
import { hasOpenAiCodexConnection } from "./credentialsRepository.ts"
import {
  PI_CODEX_PROVIDER_ID,
  PiCodexCredentialStore,
} from "./piCredentials.ts"

export type AvailableCodexModel = {
  id: string
  displayName?: string
  name?: string | null
  description?: string | null
  hidden?: boolean
  isDefault?: boolean | null
  supportedReasoningEfforts: { reasoningEffort: LlmReasoningEffort }[]
}

type CodexGenerationContext = {
  modelId: string
  start(request: PiLlmRequest): StartedLlmStream
  release(): Promise<void>
}

type CodexModelSelection = {
  modelId: string
  reasoningEffort: LlmReasoningEffort
  allowUnavailableRecommendationFallback: boolean
}

export type CodexGenerationReservation = {
  acquire(): Promise<CodexGenerationContext | undefined>
  release(): void
}

type Release = () => void

const generationTails = new Map<string, Promise<void>>()

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

async function waitForPrevious(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return previous
  if (signal.aborted) throw abortReason(signal)

  let rejectOnAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject
  })
  const onAbort = () => rejectOnAbort?.(abortReason(signal))
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    await Promise.race([previous, aborted])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

/** Reserves one direct Codex request per user before global LLM admission. */
async function acquireGenerationReservation(
  userId: string,
  signal?: AbortSignal,
): Promise<Release> {
  if (signal?.aborted) throw abortReason(signal)
  const previous = generationTails.get(userId) ?? Promise.resolve()
  const held = Promise.withResolvers<void>()
  const tail = previous.then(() => held.promise)
  generationTails.set(userId, tail)
  try {
    await waitForPrevious(previous, signal)
  } catch (error) {
    held.resolve()
    void tail.then(() => {
      if (generationTails.get(userId) === tail) generationTails.delete(userId)
    })
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    held.resolve()
    if (generationTails.get(userId) === tail) generationTails.delete(userId)
  }
}

function createCodexModels(userId: string): MutableModels {
  const models = createModels({
    credentials: new PiCodexCredentialStore(userId),
  })
  models.setProvider(openaiCodexProvider())
  return models
}

function supportedReasoningEfforts(
  model: Model<Api>,
): LlmReasoningEffort[] {
  return getSupportedThinkingLevels(model).flatMap((level) => {
    const parsed = llmReasoningEffortSchema.safeParse(
      level === "off" ? "none" : level,
    )
    return parsed.success ? [parsed.data] : []
  })
}

function listedModel(model: Model<Api>): AvailableCodexModel {
  return {
    id: model.id,
    displayName: model.name,
    isDefault: false,
    supportedReasoningEfforts: supportedReasoningEfforts(model).map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
  }
}

/** Lists Pi's direct Codex catalog for a connected account. */
export function listAvailableCodexModels(
  userId: string,
): Promise<AvailableCodexModel[] | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return Promise.resolve(undefined)
  return acquireGenerationReservation(userId).then(async (release) => {
    try {
      if (!hasOpenAiCodexConnection(userId)) return undefined
      const models = createCodexModels(userId)
      const auth = await models.getAuth(PI_CODEX_PROVIDER_ID, {
        signal: AbortSignal.timeout(config.llmExecution.firstChunkTimeoutMs),
      })
      if (!auth) throw new OpenAiCodexError("authentication-required")
      return models
        .getModels(PI_CODEX_PROVIDER_ID)
        .map(listedModel)
        .filter((model) => model.supportedReasoningEfforts.length > 0)
    } catch (error) {
      throw classifyCodexError(error)
    } finally {
      release()
    }
  })
}

/** Reserves one explicit Codex choice without occupying shared LLM capacity. */
export async function reserveCodexGeneration(
  userId: string,
  selection: CodexModelSelection,
  signal?: AbortSignal,
): Promise<CodexGenerationReservation | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return Promise.resolve(undefined)
  const releaseReservation = await acquireGenerationReservation(userId, signal)

  let consumed = false
  return {
    acquire() {
      if (consumed) {
        return Promise.reject(
          new Error("Codex generation reservation was already consumed"),
        )
      }
      consumed = true
      return acquireReservedCodexGeneration(
        userId,
        selection,
        releaseReservation,
      )
    },
    release() {
      if (consumed) return
      consumed = true
      releaseReservation()
    },
  }
}

function acquireReservedCodexGeneration(
  userId: string,
  selection: CodexModelSelection,
  releaseReservation: Release,
): Promise<CodexGenerationContext | undefined> {
  if (!hasOpenAiCodexConnection(userId)) {
    releaseReservation()
    return Promise.resolve(undefined)
  }

  try {
    const models = createCodexModels(userId)
    const selectedModel = models.getModel(
      PI_CODEX_PROVIDER_ID,
      selection.modelId,
    )
    const effortSupported = selectedModel
      ? supportedReasoningEfforts(selectedModel).includes(
          selection.reasoningEffort,
        )
      : false
    if (
      !selectedModel ||
      !hasApi(selectedModel, "openai-codex-responses") ||
      !effortSupported ||
      selection.reasoningEffort === "ultra"
    ) {
      if (selection.allowUnavailableRecommendationFallback) {
        releaseReservation()
        return Promise.resolve(undefined)
      }
      throw new OpenAiCodexError("protocol-incompatible")
    }

    return Promise.resolve({
      modelId: selectedModel.id,
      start: (request) =>
        startPiLlmStream(
          {
            models,
            model: selectedModel,
            provider: "codex",
            reasoningEffort: selection.reasoningEffort,
          },
          request,
        ),
      release: () => {
        releaseReservation()
        return Promise.resolve()
      },
    })
  } catch (error) {
    releaseReservation()
    if (
      selection.allowUnavailableRecommendationFallback &&
      error instanceof OpenAiCodexError &&
      error.code === "protocol-incompatible"
    ) {
      return Promise.resolve(undefined)
    }
    return Promise.reject(classifyCodexError(error))
  }
}
