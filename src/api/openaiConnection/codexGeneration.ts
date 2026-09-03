import { createHash } from "node:crypto"
import type { LanguageModel } from "ai"
import { createCodexAppServer } from "ai-sdk-provider-codex-cli"
import z from "zod"
import { config } from "../config.ts"
import {
  llmReasoningEffortSchema,
  type LlmReasoningEffort,
} from "../llms/modelSettings.ts"
import { classifyCodexError, OpenAiCodexError } from "./codexErrors.ts"
import {
  createCodexHome,
  readCodexCredentials,
  removeCodexHome,
} from "./codexSession/home.ts"
import { hardenedCodexConfigOverrides } from "./codexSession/policy.ts"
import {
  codexProcessEnvironment,
  FatalCodexContainmentError,
  getCodexExecutablePath,
  reapCodexProcessGroup,
  terminateApiForUnreapedCodexProcess,
} from "./codexSession/process.ts"
import { acquireCodexProcess } from "./codexProcessSlots.ts"
import {
  compareAndSwapOpenAiCodexCredentials,
  getOpenAiCodexConnection,
  hasOpenAiCodexConnection,
} from "./credentialsRepository.ts"

const modelSchema = z.object({
  id: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256).optional(),
  name: z.string().min(1).max(256).nullable().optional(),
  description: z.string().max(2_000).nullable().optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().nullable().optional(),
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: llmReasoningEffortSchema,
      }),
    )
    .max(8),
})

export type AvailableCodexModel = z.output<typeof modelSchema>

function digest(credentials: Buffer): Buffer {
  return createHash("sha256").update(credentials).digest()
}

type CodexSession = {
  provider: ReturnType<typeof createCodexAppServer>
  models: AvailableCodexModel[]
  release(): Promise<void>
}

type CodexGenerationContext = {
  model: LanguageModel
  modelId: string
  wrapStream<Part>(source: AsyncIterable<Part>): AsyncIterable<Part>
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

function createProvider(home: Awaited<ReturnType<typeof createCodexHome>>) {
  return createCodexAppServer({
    defaultSettings: {
      codexPath: getCodexExecutablePath(),
      cwd: home.work,
      env: codexProcessEnvironment(home),
      logger: false,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "externalSandbox",
        networkAccess: "restricted",
      },
      autoApprove: false,
      persistExtendedHistory: false,
      threadMode: "stateless",
      minCodexVersion: "0.149.1",
      connectionTimeoutMs: config.llmExecution.firstChunkTimeoutMs,
      requestTimeoutMs: config.llmExecution.totalTimeoutMs,
      configOverrides: hardenedCodexConfigOverrides,
    },
  })
}

async function openReservedCodexSession(
  userId: string,
  releaseProcess: () => void,
): Promise<CodexSession | undefined> {
  let connection: ReturnType<typeof getOpenAiCodexConnection>
  try {
    connection = getOpenAiCodexConnection(userId)
  } catch (error) {
    releaseProcess()
    throw classifyCodexError(error)
  }
  if (!connection) {
    releaseProcess()
    return
  }

  const originalDigest = digest(connection.credentials)
  let home: Awaited<ReturnType<typeof createCodexHome>> | undefined
  let provider: ReturnType<typeof createCodexAppServer> | undefined
  let releasePromise: Promise<void> | undefined

  const releaseInternal = async (): Promise<void> => {
    let processStopped = false
    let homeRemoved = home === undefined
    let failure: OpenAiCodexError | undefined
    try {
      try {
        await provider?.close()
      } catch (error) {
        failure = classifyCodexError(error)
      }
      if (home && provider) {
        try {
          await reapCodexProcessGroup(home)
          processStopped = true
        } catch {
          terminateApiForUnreapedCodexProcess()
        }
      } else {
        processStopped = true
      }
      if (home && processStopped) {
        try {
          const refreshed = await readCodexCredentials(home)
          try {
            if (!digest(refreshed).equals(originalDigest)) {
              compareAndSwapOpenAiCodexCredentials(connection, refreshed)
            }
          } finally {
            refreshed.fill(0)
          }
        } catch (error) {
          failure ??= classifyCodexError(error)
        }
        try {
          await removeCodexHome(home)
          homeRemoved = true
        } catch {
          terminateApiForUnreapedCodexProcess()
        }
      }
    } finally {
      connection.credentials.fill(0)
      originalDigest.fill(0)
      if (processStopped && homeRemoved) releaseProcess()
    }
    if (failure) throw failure
  }

  const release = (): Promise<void> => {
    releasePromise ??= releaseInternal()
    return releasePromise
  }

  try {
    home = await createCodexHome(connection.credentials)
    connection.credentials.fill(0)
    provider = createProvider(home)
    const result = await provider.listModels()
    const models = z.array(modelSchema).max(100).parse(result.models)
    return { provider, models, release }
  } catch (error) {
    if (error instanceof FatalCodexContainmentError) {
      connection.credentials.fill(0)
      originalDigest.fill(0)
      throw error
    }
    try {
      await release()
    } catch (releaseError) {
      if (releaseError instanceof FatalCodexContainmentError) {
        throw releaseError
      }
    }
    throw classifyCodexError(error)
  }
}

/** Lists the connected account's visible models inside the contained session. */
export async function listAvailableCodexModels(
  userId: string,
): Promise<AvailableCodexModel[] | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return
  const releaseProcess = await acquireCodexProcess(userId)
  const session = await openReservedCodexSession(userId, releaseProcess)
  if (!session) return
  try {
    return session.models.filter(
      (model) =>
        model.hidden !== true && model.supportedReasoningEfforts.length > 0,
    )
  } finally {
    await session.release()
  }
}

/** Reserves one explicit Codex choice without occupying shared LLM capacity. */
export async function reserveCodexGeneration(
  userId: string,
  selection: CodexModelSelection,
  signal?: AbortSignal,
): Promise<CodexGenerationReservation | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return

  const releaseProcess = await acquireCodexProcess(
    userId,
    signal ? { signal } : {},
  )

  let consumed = false
  return {
    acquire() {
      if (consumed) {
        throw new Error("Codex generation reservation was already consumed")
      }
      consumed = true
      return acquireReservedCodexGeneration(
        userId,
        selection,
        releaseProcess,
      )
    },
    release() {
      if (consumed) return
      consumed = true
      releaseProcess()
    },
  }
}

async function acquireReservedCodexGeneration(
  userId: string,
  selection: CodexModelSelection,
  releaseProcess: () => void,
): Promise<CodexGenerationContext | undefined> {
  const session = await openReservedCodexSession(userId, releaseProcess)
  if (!session) return

  const selectedModel = session.models.find(
    (candidate) =>
      candidate.hidden !== true && candidate.id === selection.modelId,
  )
  const supportsEffort = selectedModel?.supportedReasoningEfforts.some(
    (option) => option.reasoningEffort === selection.reasoningEffort,
  )
  if (!selectedModel || !supportsEffort) {
    await session.release()
    if (selection.allowUnavailableRecommendationFallback) return
    throw new OpenAiCodexError("protocol-incompatible")
  }

  const model = session.provider(selectedModel.id, {
    configOverrides: {
      ...hardenedCodexConfigOverrides,
      model_reasoning_effort: selection.reasoningEffort,
    },
  })

  return {
    model,
    modelId: selectedModel.id,
    async *wrapStream<Part>(source: AsyncIterable<Part>) {
      try {
        for await (const part of source) {
          const typed = part as { type?: string; error?: unknown }
          if (
            typed.type === "tool-call" ||
            typed.type === "tool-result" ||
            typed.type === "tool-approval-request"
          ) {
            throw new OpenAiCodexError("tool-blocked")
          }
          if (typed.type === "error") {
            yield {
              ...(part as object),
              error: classifyCodexError(typed.error),
            } as Part
          } else {
            yield part
          }
        }
      } catch (error) {
        throw classifyCodexError(error)
      } finally {
        await session.release()
      }
    },
    release: () => session.release(),
  }
}
