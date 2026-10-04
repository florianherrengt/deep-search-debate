import {
  createModels,
  getSupportedThinkingLevels,
  hasApi,
  type Api,
  type Model,
  type MutableModels,
  type ThinkingLevelMap,
} from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import z from "zod"

import packageMetadata from "../package.json" with { type: "json" }
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
import { createBoundedFetch } from "../web_search/boundedFetch.ts"
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
const MAX_CODEX_MODEL_LIST_BYTES = 2 * 1_024 * 1_024
const boundedFetch = createBoundedFetch(MAX_CODEX_MODEL_LIST_BYTES)

const codexModelListSchema = z.object({
  models: z.array(z.object({
    slug: z.string().min(1).max(256),
    display_name: z.string().min(1).max(256),
    description: z.string().max(4_000).nullish(),
    visibility: z.string(),
    supported_in_api: z.boolean(),
    input_modalities: z.array(z.string()).max(20).default(["text", "image"]),
    context_window: z.number().int().positive().nullish(),
    supported_reasoning_levels: z.array(z.object({
      effort: z.string(),
    }).loose()).max(20),
  }).loose()).max(1_000),
}).loose()

const accountClaimSchema = z.object({
  "https://api.openai.com/auth": z.object({
    chatgpt_account_id: z.string().min(1).max(1_000),
  }),
})

const piThinkingLevels = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
] as const
type LiveCodexModel = {
  model: Model<"openai-codex-responses">
  description?: string
}

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

function accountIdFromToken(token: string): string {
  try {
    const parts = token.split(".")
    if (parts.length !== 3 || !parts[1]) {
      throw new Error("Invalid access token")
    }
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    return accountClaimSchema.parse(claims)["https://api.openai.com/auth"]
      .chatgpt_account_id
  } catch {
    throw new OpenAiCodexError("protocol-incompatible")
  }
}

function liveModel(
  entry: z.output<typeof codexModelListSchema>["models"][number],
  baseUrl: string,
  contextWindow: number,
): LiveCodexModel {
  const advertised = new Set(entry.supported_reasoning_levels.map(({ effort }) =>
    effort === "none" ? "off" : effort
  ))
  const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(
    piThinkingLevels.map((level) => [
      level,
      advertised.has(level) ? (level === "off" ? "none" : level) : null,
    ]),
  )
  const model: Model<"openai-codex-responses"> = {
    id: entry.slug,
    name: entry.display_name,
    api: "openai-codex-responses",
    provider: PI_CODEX_PROVIDER_ID,
    baseUrl,
    reasoning: entry.supported_reasoning_levels.length > 0,
    thinkingLevelMap,
    input: entry.input_modalities.includes("image")
      ? ["text", "image"]
      : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    // Pi requires this field; its Codex stream does not use it. The context
    // window is an upper bound, not a claim about the model's output limit.
    maxTokens: contextWindow,
    compat: { supportsOpenAIGrammarTools: true },
  }
  return {
    model,
    ...(entry.description && { description: entry.description }),
  }
}

async function loadLiveCodexModels(
  models: MutableModels,
  userId: string,
  workflowSignal?: AbortSignal,
): Promise<LiveCodexModel[]> {
  const timeoutSignal = AbortSignal.timeout(config.llmExecution.firstChunkTimeoutMs)
  const signal = workflowSignal
    ? AbortSignal.any([workflowSignal, timeoutSignal])
    : timeoutSignal
  const auth = await models.getAuth(PI_CODEX_PROVIDER_ID, { signal })
  const token = auth?.auth.apiKey
  if (!token) throw new OpenAiCodexError("authentication-required")
  const accountId = accountIdFromToken(token)
  const provider = models.getProvider(PI_CODEX_PROVIDER_ID)
  const baseUrl = provider?.baseUrl
  if (!provider || !baseUrl) throw new OpenAiCodexError("protocol-incompatible")
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/codex/models`)
  url.searchParams.set("client_version", packageMetadata.version)
  const response = await boundedFetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "chatgpt-account-id": accountId,
      originator: "pi",
    },
    signal,
  })
  if (!response.ok) {
    switch (response.status) {
      case 401: throw new OpenAiCodexError("authentication-required")
      case 403: throw new OpenAiCodexError("workspace-disabled")
      case 429: throw new OpenAiCodexError("rate-limited")
      case 400: throw new OpenAiCodexError("protocol-incompatible")
      default: throw new OpenAiCodexError("temporarily-unavailable")
    }
  }
  const catalog = codexModelListSchema.parse(await response.json())
  signal.throwIfAborted()
  if (!hasOpenAiCodexConnection(userId)) return []
  const currentToken = (await models.getAuth(PI_CODEX_PROVIDER_ID, { signal }))
    ?.auth.apiKey
  if (!currentToken || accountIdFromToken(currentToken) !== accountId) {
    throw new OpenAiCodexError("temporarily-unavailable")
  }
  const live = catalog.models.flatMap((entry) => {
    if (
      entry.visibility !== "list" ||
      !entry.input_modalities.includes("text") ||
      !entry.context_window
    ) return []
    const mapped = liveModel(entry, baseUrl, entry.context_window)
    return supportedReasoningEfforts(mapped.model).length > 0 ? [mapped] : []
  })

  // Keep Pi's OAuth and streaming implementation, replacing only its bundled
  // static model list in this request-scoped registry.
  models.setProvider({
    ...provider,
    getModels: () => live.map(({ model }) => model),
  })
  return live
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

function listedModel({ model, description }: LiveCodexModel): AvailableCodexModel {
  return {
    id: model.id,
    displayName: model.name,
    ...(description && { description }),
    isDefault: false,
    supportedReasoningEfforts: supportedReasoningEfforts(model).map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
  }
}

/** Lists models independently of generation reservations so Settings stays responsive. */
export async function listAvailableCodexModels(
  userId: string,
  signal?: AbortSignal,
): Promise<AvailableCodexModel[] | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return undefined
  try {
    const models = createCodexModels(userId)
    const live = await loadLiveCodexModels(models, userId, signal)
    if (!hasOpenAiCodexConnection(userId)) return undefined
    return live.map(listedModel)
  } catch (error) {
    throw classifyCodexError(error)
  }
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
        signal,
      )
    },
    release() {
      if (consumed) return
      consumed = true
      releaseReservation()
    },
  }
}

async function acquireReservedCodexGeneration(
  userId: string,
  selection: CodexModelSelection,
  releaseReservation: Release,
  signal?: AbortSignal,
): Promise<CodexGenerationContext | undefined> {
  if (!hasOpenAiCodexConnection(userId)) {
    releaseReservation()
    return undefined
  }

  try {
    const models = createCodexModels(userId)
    await loadLiveCodexModels(models, userId, signal)
    signal?.throwIfAborted()
    if (!hasOpenAiCodexConnection(userId)) {
      releaseReservation()
      return undefined
    }
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
        return undefined
      }
      throw new OpenAiCodexError("protocol-incompatible")
    }

    return {
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
    }
  } catch (error) {
    releaseReservation()
    if (signal?.aborted) throw abortReason(signal)
    throw classifyCodexError(error)
  }
}
