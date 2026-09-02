import { HTTPException } from "hono/http-exception"
import z from "zod"
import {
  deleteOpenAiCodexConnectionForUser,
  hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection,
} from "./credentialsRepository.ts"
import { classifyCodexError, OpenAiCodexError } from "./codexErrors.ts"
import {
  createCodexHome,
  readCodexCredentials,
  removeCodexHome,
  type CodexHome,
} from "./codexSession/home.ts"
import {
  FatalCodexContainmentError,
  terminateApiForUnreapedCodexProcess,
} from "./codexSession/process.ts"
import {
  accountReadSchema,
  CodexRpcClient,
  deviceLoginResultSchema,
  loginCompletedSchema,
} from "./codexRpcClient.ts"
import { acquireCodexLoginProcess } from "./codexProcessSlots.ts"

const DEVICE_LOGIN_LIFETIME_MS = 15 * 60 * 1_000

export type OpenAiConnectionSnapshot =
  | { status: "disconnected" }
  | {
      status: "pending"
      verificationUrl: string
      userCode: string
      expiresAt: string
    }
  | { status: "connected" }
  | { status: "failed"; message: string }

type PendingLogin = {
  userId: string
  loginId: string
  verificationUrl: string
  userCode: string
  expiresAt: Date
  home: CodexHome
  client: CodexRpcClient
  release: () => void
  cancelled: boolean
  finalization?: Promise<void>
  expiryTimer: NodeJS.Timeout
}

let pendingLogin: PendingLogin | undefined
const failedLogins = new Map<string, OpenAiCodexError>()
const connectionVersions = new Map<string, number>()

function pendingSnapshot(pending: PendingLogin): OpenAiConnectionSnapshot {
  return {
    status: "pending",
    verificationUrl: pending.verificationUrl,
    userCode: pending.userCode,
    expiresAt: pending.expiresAt.toISOString(),
  }
}

async function removeCodexHomeOrTerminate(home: CodexHome): Promise<void> {
  try {
    await removeCodexHome(home)
  } catch {
    terminateApiForUnreapedCodexProcess()
  }
}

function finalizePendingLoginFromNotification(
  pending: PendingLogin,
  result: { loginId: string | null; success: boolean; error: string | null },
): void {
  void finalizePendingLogin(pending, result).catch((error: unknown) => {
    if (!(error instanceof FatalCodexContainmentError)) throw error
  })
}

export function getOpenAiConnectionSnapshot(
  userId: string,
): OpenAiConnectionSnapshot {
  if (hasOpenAiCodexConnection(userId)) return { status: "connected" }
  if (pendingLogin?.userId === userId) return pendingSnapshot(pendingLogin)
  const failed = failedLogins.get(userId)
  return failed
    ? { status: "failed", message: failed.message }
    : { status: "disconnected" }
}

export async function startOpenAiConnection(
  userId: string,
): Promise<OpenAiConnectionSnapshot> {
  if (hasOpenAiCodexConnection(userId)) return { status: "connected" }
  if (pendingLogin?.userId === userId) return pendingSnapshot(pendingLogin)
  const connectionVersion = connectionVersions.get(userId) ?? 0

  failedLogins.delete(userId)
  const release = acquireCodexLoginProcess()
  if (!release) {
    throw new HTTPException(429, {
      message: "Too many OpenAI connection attempts are active. Try again shortly.",
    })
  }

  let home: CodexHome | undefined
  let client: CodexRpcClient | undefined
  try {
    home = await createCodexHome()
    client = new CodexRpcClient(home)
    await client.start()
    const state: { pending?: PendingLogin } = {}
    let earlyCompletion: z.output<typeof loginCompletedSchema> | undefined
    client.on("account/login/completed", (value) => {
      const completed = loginCompletedSchema.safeParse(value)
      if (!completed.success) return
      if (!state.pending) {
        earlyCompletion = completed.data
        return
      }
      finalizePendingLoginFromNotification(
        state.pending,
        completed.data.loginId === state.pending.loginId
          ? completed.data
          : {
              loginId: state.pending.loginId,
              success: false,
              error: "protocol",
            },
      )
    })
    const login = await client.request(
      "account/login/start",
      { type: "chatgptDeviceCode" },
      deviceLoginResultSchema,
    )
    if ((connectionVersions.get(userId) ?? 0) !== connectionVersion) {
      await client
        .request(
          "account/login/cancel",
          { loginId: login.loginId },
          z.object({}).strict(),
        )
        .catch(() => undefined)
      await client.close()
      await removeCodexHomeOrTerminate(home)
      release()
      return { status: "disconnected" }
    }
    const expiresAt = new Date(Date.now() + DEVICE_LOGIN_LIFETIME_MS)
    const expiryTimer = setTimeout(() => {
      if (!pending) return
      finalizePendingLoginFromNotification(pending, {
        loginId: pending.loginId,
        success: false,
        error: "timeout",
      })
    }, DEVICE_LOGIN_LIFETIME_MS)
    expiryTimer.unref?.()
    const pending: PendingLogin = {
      userId,
      loginId: login.loginId,
      verificationUrl: login.verificationUrl,
      userCode: login.userCode,
      expiresAt,
      home,
      client,
      release,
      cancelled: false,
      expiryTimer,
    }
    state.pending = pending
    pendingLogin = pending
    if (earlyCompletion) {
      finalizePendingLoginFromNotification(
        pending,
        earlyCompletion.loginId === pending.loginId
          ? earlyCompletion
          : {
              loginId: pending.loginId,
              success: false,
              error: "protocol",
            },
      )
    }
    return pendingSnapshot(pending)
  } catch (error) {
    if (error instanceof FatalCodexContainmentError) throw error
    const safeError = classifyCodexError(error)
    failedLogins.set(userId, safeError)
    try {
      await client?.close()
    } catch (closeError) {
      if (closeError instanceof FatalCodexContainmentError) throw closeError
    }
    if (home) await removeCodexHomeOrTerminate(home)
    release()
    return { status: "failed", message: safeError.message }
  }
}

async function finalizePendingLogin(
  pending: PendingLogin,
  result: { loginId: string | null; success: boolean; error: string | null },
): Promise<void> {
  if (pending.finalization) return pending.finalization
  pending.finalization = (async () => {
    clearTimeout(pending.expiryTimer)
    let failure: OpenAiCodexError | undefined
    let processExitProven = false
    try {
      if (!result.success) {
        failure = result.error === "timeout"
          ? new OpenAiCodexError("timeout")
          : classifyCodexError(result.error)
      } else {
        const account = await pending.client.request(
          "account/read",
          { refreshToken: false },
          accountReadSchema,
        )
        if (!account.account || account.account.type !== "chatgpt") {
          throw new OpenAiCodexError("authentication-required")
        }
      }

      await pending.client.close()
      processExitProven = true
      if (!failure && !pending.cancelled) {
        const credentials = await readCodexCredentials(pending.home)
        try {
          if (!pending.cancelled) {
            replaceOpenAiCodexConnection(pending.userId, credentials)
          }
        } finally {
          credentials.fill(0)
        }
      }
    } catch (error) {
      if (error instanceof FatalCodexContainmentError) throw error
      failure = classifyCodexError(error)
      try {
        await pending.client.close()
        processExitProven = true
      } catch (closeError) {
        if (closeError instanceof FatalCodexContainmentError) throw closeError
        failure = classifyCodexError(closeError)
      }
    } finally {
      if (processExitProven) {
        await removeCodexHomeOrTerminate(pending.home)
        if (pendingLogin === pending) pendingLogin = undefined
        pending.release()
      }
    }

    if (pending.cancelled) {
      failedLogins.delete(pending.userId)
    } else if (failure) {
      failedLogins.set(pending.userId, failure)
    } else {
      failedLogins.delete(pending.userId)
    }
  })()
  return pending.finalization
}

export async function disconnectOpenAiConnection(
  userId: string,
): Promise<OpenAiConnectionSnapshot> {
  connectionVersions.set(userId, (connectionVersions.get(userId) ?? 0) + 1)
  failedLogins.delete(userId)
  const pending = pendingLogin?.userId === userId ? pendingLogin : undefined
  if (pending) {
    pending.cancelled = true
    await pending.client
      .request(
        "account/login/cancel",
        { loginId: pending.loginId },
        z.object({}).strict(),
      )
      .catch(() => undefined)
    await finalizePendingLogin(pending, {
      loginId: pending.loginId,
      success: false,
      error: null,
    })
  }

  deleteOpenAiCodexConnectionForUser(userId)
  return { status: "disconnected" }
}

export async function closeOpenAiConnectionProcesses(): Promise<void> {
  const pending = pendingLogin
  if (!pending) return
  pending.cancelled = true
  await finalizePendingLogin(pending, {
    loginId: pending.loginId,
    success: false,
    error: null,
  }).catch(() => undefined)
}
