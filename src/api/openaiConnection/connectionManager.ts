import type {
  AuthEvent,
  AuthPrompt,
  OAuthCredential,
} from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { HTTPException } from "hono/http-exception"
import z from "zod"

import { disconnectOpenAiAndResetModelAssignments } from "../llms/modelSettings.ts"
import { classifyCodexError, OpenAiCodexError } from "./codexErrors.ts"
import {
  hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection,
} from "./credentialsRepository.ts"
import {
  encodePiCodexCredential,
  withPiCodexCredentialLock,
} from "./piCredentials.ts"

const deviceCodeEventSchema = z.object({
  type: z.literal("device_code"),
  userCode: z.string().trim().min(1).max(128),
  verificationUri: z
    .url()
    .refine((value) => new URL(value).protocol === "https:"),
  intervalSeconds: z.number().positive().max(60).optional(),
  expiresInSeconds: z.number().int().positive().max(60 * 60).optional(),
})

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

type PendingInstructions = Extract<
  OpenAiConnectionSnapshot,
  { status: "pending" }
>

type ActiveLogin = {
  userId: string
  connectionVersion: number
  controller: AbortController
  started: PromiseWithResolvers<OpenAiConnectionSnapshot>
  instructions?: PendingInstructions
  cancelled: boolean
  timedOut: boolean
  timeout?: NodeJS.Timeout
  completion?: Promise<void>
}

let activeLogin: ActiveLogin | undefined
const failedLogins = new Map<string, OpenAiCodexError>()
const connectionVersions = new Map<string, number>()

function loginPrompt(prompt: AuthPrompt): Promise<string> {
  if (
    prompt.type === "select" &&
    prompt.options.some((option) => option.id === "device_code")
  ) {
    return Promise.resolve("device_code")
  }
  return Promise.reject(new OpenAiCodexError("protocol-incompatible"))
}

function loginNotification(login: ActiveLogin, event: AuthEvent): void {
  if (event.type !== "device_code") return
  if (login.instructions) {
    throw new OpenAiCodexError("protocol-incompatible")
  }
  const parsed = deviceCodeEventSchema.safeParse(event)
  if (!parsed.success) throw new OpenAiCodexError("protocol-incompatible")
  const device = parsed.data
  const expiresAt = new Date(
    Date.now() + (device.expiresInSeconds ?? 15 * 60) * 1_000,
  )
  login.instructions = {
    status: "pending",
    verificationUrl: device.verificationUri,
    userCode: device.userCode,
    expiresAt: expiresAt.toISOString(),
  }
  login.started.resolve(login.instructions)
}

function isCancelled(login: ActiveLogin): boolean {
  return (
    login.cancelled ||
    (!login.timedOut && login.controller.signal.aborted) ||
    (connectionVersions.get(login.userId) ?? 0) !== login.connectionVersion
  )
}

async function persistCompletedLogin(
  login: ActiveLogin,
  credential: OAuthCredential,
): Promise<boolean> {
  return withPiCodexCredentialLock(login.userId, () => {
    if (isCancelled(login)) return false
    const encoded = encodePiCodexCredential(credential)
    try {
      replaceOpenAiCodexConnection(login.userId, encoded)
      return true
    } finally {
      encoded.fill(0)
    }
  })
}

async function runLogin(login: ActiveLogin): Promise<void> {
  try {
    const oauth = openaiCodexProvider().auth.oauth
    if (!oauth) throw new OpenAiCodexError("protocol-incompatible")
    const credential = await oauth.login({
      signal: login.controller.signal,
      prompt: loginPrompt,
      notify: (event) => loginNotification(login, event),
    })
    if (!login.instructions) {
      throw new OpenAiCodexError("protocol-incompatible")
    }
    if (await persistCompletedLogin(login, credential)) {
      failedLogins.delete(login.userId)
    }
  } catch (error) {
    if (!isCancelled(login)) {
      const safeError = login.timedOut
        ? new OpenAiCodexError("timeout")
        : classifyCodexError(error)
      failedLogins.set(login.userId, safeError)
      login.started.resolve({ status: "failed", message: safeError.message })
    }
  } finally {
    if (login.timeout) clearTimeout(login.timeout)
    if (isCancelled(login)) {
      failedLogins.delete(login.userId)
      login.started.resolve({ status: "disconnected" })
    }
    if (activeLogin === login) activeLogin = undefined
  }
}

export function getOpenAiConnectionSnapshot(
  userId: string,
): OpenAiConnectionSnapshot {
  if (hasOpenAiCodexConnection(userId)) return { status: "connected" }
  if (activeLogin?.userId === userId && activeLogin.instructions) {
    return activeLogin.instructions
  }
  const failed = failedLogins.get(userId)
  return failed
    ? { status: "failed", message: failed.message }
    : { status: "disconnected" }
}

export async function startOpenAiConnection(
  userId: string,
): Promise<OpenAiConnectionSnapshot> {
  if (hasOpenAiCodexConnection(userId)) return { status: "connected" }
  if (activeLogin?.userId === userId) {
    return activeLogin.instructions ?? activeLogin.started.promise
  }
  if (activeLogin) {
    throw new HTTPException(429, {
      message: "Too many OpenAI connection attempts are active. Try again shortly.",
    })
  }

  failedLogins.delete(userId)
  const login: ActiveLogin = {
    userId,
    connectionVersion: connectionVersions.get(userId) ?? 0,
    controller: new AbortController(),
    started: Promise.withResolvers<OpenAiConnectionSnapshot>(),
    cancelled: false,
    timedOut: false,
  }
  activeLogin = login
  login.timeout = setTimeout(() => {
    login.timedOut = true
    login.controller.abort(new OpenAiCodexError("timeout"))
  }, 15 * 60 * 1_000)
  login.completion = runLogin(login)
  return login.started.promise
}

export async function disconnectOpenAiConnection(
  userId: string,
): Promise<OpenAiConnectionSnapshot> {
  connectionVersions.set(userId, (connectionVersions.get(userId) ?? 0) + 1)
  failedLogins.delete(userId)
  const login = activeLogin?.userId === userId ? activeLogin : undefined
  if (login) {
    login.cancelled = true
    login.controller.abort()
    await login.completion
  }

  await withPiCodexCredentialLock(userId, () => {
    disconnectOpenAiAndResetModelAssignments(userId)
  })
  return { status: "disconnected" }
}

/** Cancels the one device login operation retained by this API process. */
export async function closeOpenAiConnectionOperations(): Promise<void> {
  const login = activeLogin
  if (!login) return
  login.cancelled = true
  login.controller.abort()
  await login.completion
}
