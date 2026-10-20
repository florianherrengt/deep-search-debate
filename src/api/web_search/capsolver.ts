import z from "zod"

import { config } from "../config.ts"
import { createBoundedFetch } from "./boundedFetch.ts"
import {
  registerCaptchaTask,
  reserveCaptchaAttempt,
} from "../routes/deepSearch/captcha.ts"

const apiUrl = "https://api.capsolver.com"
const pollIntervalMs = 2_000
const maxPolls = 120
const maxSolverResponseBytes = 256 * 1_024

const createResponseSchema = z.looseObject({
  errorId: z.number(),
  taskId: z.string().trim().min(1).optional(),
})
const resultResponseSchema = z.looseObject({
  errorId: z.number(),
  status: z.enum(["idle", "processing", "ready", "failed"]).optional(),
  solution: z.looseObject({
    token: z.string().trim().min(1).optional(),
    gRecaptchaResponse: z.string().trim().min(1).optional(),
  }).optional(),
})

export type CapSolverChallenge =
  | { family: "turnstile"; websiteKey: string; action?: string; cdata?: string; widgetId: string; callbackName?: string }
  | { family: "recaptcha-v2"; websiteKey: string; widgetId: string; callbackName?: string }

export type CapSolverOutcome =
  | { status: "solved"; family: CapSolverChallenge["family"] }
  | { status: "unsupported"; reason: "missing-api-key" }
  | { status: "failed"; reason: "attempt-limit" | "attempt-already-reserved" | "solver-failed" | "solver-timeout" | "solver-unavailable" }

export type CapSolverParams = {
  challenge: CapSolverChallenge
  userId: string
  deepSearchJobId: string
  pageId: string
  url: string
  signal: AbortSignal
}

type CapSolverDependencies = {
  fetch?: typeof fetch
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  reserve?: typeof reserveCaptchaAttempt
  register?: typeof registerCaptchaTask
  apiKey?: string
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  const abortError = signal.reason instanceof Error ? signal.reason : new Error("CapSolver request aborted")
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError)
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      reject(abortError)
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}

/** Calls CapSolver at most once for this page attempt and never repeats an uncertain createTask. */
export async function solveCaptchaToken(
  params: CapSolverParams,
  dependencies: CapSolverDependencies = {},
): Promise<{ outcome: CapSolverOutcome; token?: string }> {
  if (params.signal.aborted) return { outcome: { status: "failed", reason: "solver-unavailable" } }
  const apiKey = dependencies.apiKey ?? config.extraction.capsolver.apiKey
  if (!apiKey) return { outcome: { status: "unsupported", reason: "missing-api-key" } }

  let reservation: Awaited<ReturnType<typeof reserveCaptchaAttempt>>
  try {
    reservation = (dependencies.reserve ?? reserveCaptchaAttempt)({
      userId: params.userId,
      deepSearchJobId: params.deepSearchJobId,
      pageId: params.pageId,
      maxTasksPerRootJob: config.extraction.capsolver.maxTasksPerRootJob,
    })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "budget-exhausted") {
      return { outcome: { status: "failed", reason: "attempt-limit" } }
    }
    return { outcome: { status: "failed", reason: "solver-unavailable" } }
  }
  if (!reservation.created && !reservation.taskId) {
    return { outcome: { status: "failed", reason: "attempt-already-reserved" } }
  }

  const timeoutSignal = AbortSignal.timeout(120_000)
  const signal = AbortSignal.any([params.signal, timeoutSignal])
  const request = createBoundedFetch(maxSolverResponseBytes, dependencies.fetch ?? fetch)
  const wait = dependencies.sleep ?? sleep
  let taskId = reservation.taskId

  try {
    if (reservation.created) {
      const task = params.challenge.family === "turnstile"
        ? {
            type: "AntiTurnstileTaskProxyLess",
            websiteURL: params.url,
            websiteKey: params.challenge.websiteKey,
            metadata: {
              ...(params.challenge.action && { action: params.challenge.action }),
              ...(params.challenge.cdata && { cdata: params.challenge.cdata }),
            },
          }
        : {
            type: "ReCaptchaV2TaskProxyLess",
            websiteURL: params.url,
            websiteKey: params.challenge.websiteKey,
          }
      const response = await request(`${apiUrl}/createTask`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, task }),
        signal,
      })
      if (!response.ok) return { outcome: { status: "failed", reason: "solver-unavailable" } }
      const parsed = createResponseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.errorId !== 0 || !parsed.data.taskId) {
        return { outcome: { status: "failed", reason: "solver-failed" } }
      }
      taskId = parsed.data.taskId;
      (dependencies.register ?? registerCaptchaTask)({
        userId: params.userId,
        deepSearchJobId: params.deepSearchJobId,
        pageId: params.pageId,
        taskId,
      })
    }

    if (!taskId) return { outcome: { status: "failed", reason: "solver-failed" } }

    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (signal.aborted) {
        return { outcome: { status: "failed", reason: timeoutSignal.aborted ? "solver-timeout" : "solver-unavailable" } }
      }
      const response = await request(`${apiUrl}/getTaskResult`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
        signal,
      })
      if (!response.ok) return { outcome: { status: "failed", reason: "solver-unavailable" } }
      const parsed = resultResponseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.errorId !== 0 || parsed.data.status === "failed") {
        return { outcome: { status: "failed", reason: "solver-failed" } }
      }
      if (parsed.data.status === "ready") {
        const token = params.challenge.family === "turnstile"
          ? parsed.data.solution?.token
          : parsed.data.solution?.gRecaptchaResponse
        return token
          ? { outcome: { status: "solved", family: params.challenge.family }, token }
          : { outcome: { status: "failed", reason: "solver-failed" } }
      }
      await wait(pollIntervalMs, signal)
    }
    return { outcome: { status: "failed", reason: "solver-timeout" } }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "budget-exhausted") {
      return { outcome: { status: "failed", reason: "attempt-limit" } }
    }
    return {
      outcome: {
        status: "failed",
        reason: timeoutSignal.aborted ? "solver-timeout" : "solver-unavailable",
      },
    }
  }
}
