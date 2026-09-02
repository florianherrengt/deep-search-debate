import { createHash } from "node:crypto"
import type { LanguageModel } from "ai"
import { createCodexAppServer } from "ai-sdk-provider-codex-cli"
import z from "zod"
import { config } from "../config.ts"
import type { LlmCallReasoning } from "../llms/provider.ts"
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

const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
])

const modelSchema = z.object({
  id: z.string().min(1),
  isDefault: z.literal(true),
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: reasoningEffortSchema,
      }),
    )
    .min(1),
})

const effortOrder = reasoningEffortSchema.options

function selectReasoningEffort(
  model: z.output<typeof modelSchema>,
  reasoning: LlmCallReasoning,
): z.output<typeof reasoningEffortSchema> {
  const supported = new Set(
    model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
  )
  const ordered = effortOrder.filter((effort) => supported.has(effort))
  const selected = reasoning === "enabled" ? ordered.at(-1) : ordered[0]
  if (!selected) throw new OpenAiCodexError("protocol-incompatible")
  return selected
}

function digest(credentials: Buffer): Buffer {
  return createHash("sha256").update(credentials).digest()
}

type CodexGenerationContext = {
  model: LanguageModel
  modelId: string
  wrapStream<Part>(source: AsyncIterable<Part>): AsyncIterable<Part>
  release(): Promise<void>
}

export type CodexGenerationReservation = {
  acquire(
    reasoning: LlmCallReasoning,
  ): Promise<CodexGenerationContext | undefined>
  release(): void
}

/**
 * Serializes one user's credential-bearing processes before shared LLM
 * admission, without decrypting credentials or starting Codex while queued.
 */
export async function reserveCodexGeneration(
  userId: string,
  signal?: AbortSignal,
): Promise<CodexGenerationReservation | undefined> {
  if (!hasOpenAiCodexConnection(userId)) return

  const releaseProcess = await acquireCodexProcess(
    userId,
    signal ? { signal } : {},
  )

  let consumed = false
  return {
    acquire(reasoning) {
      if (consumed) {
        throw new Error("Codex generation reservation was already consumed")
      }
      consumed = true
      return acquireReservedCodexGeneration(userId, reasoning, releaseProcess)
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
  reasoning: LlmCallReasoning,
  releaseProcess: () => void,
): Promise<CodexGenerationContext | undefined> {
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
    provider = createCodexAppServer({
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
    const modelList = await provider.listModels()
    const defaults = modelList.models.filter(
      (candidate) => candidate.isDefault === true,
    )
    if (defaults.length !== 1) {
      throw new OpenAiCodexError("protocol-incompatible")
    }
    const selectedModel = modelSchema.parse(defaults[0])
    const effort = selectReasoningEffort(selectedModel, reasoning)
    const model = provider(selectedModel.id, {
      configOverrides: {
        ...hardenedCodexConfigOverrides,
        model_reasoning_effort: effort,
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
          await release()
        }
      },
      release,
    }
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
