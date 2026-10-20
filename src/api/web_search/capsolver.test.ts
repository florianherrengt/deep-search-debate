import { beforeEach, describe, expect, it, vi } from "vitest"

import { solveCaptchaToken } from "./capsolver.ts"

const reserve = vi.fn()
const register = vi.fn()
const fetcher = vi.fn()
const sleep = vi.fn(() => Promise.resolve())
const params = {
  challenge: { family: "turnstile" as const, websiteKey: "site-key", action: "research", widgetId: "widget-1" },
  userId: "user-1",
  deepSearchJobId: "job-1",
  pageId: "page-1",
  url: "https://example.org/source",
  signal: new AbortController().signal,
}

function response(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500 })
}

beforeEach(() => {
  vi.clearAllMocks()
  reserve.mockReturnValue({ created: true, taskId: null })
})

describe("CapSolver", () => {
  it("creates, registers, and polls a Turnstile task, returning its token only to the caller", async () => {
    fetcher
      .mockResolvedValueOnce(response({ errorId: 0, taskId: "task-1" }))
      .mockResolvedValueOnce(response({ errorId: 0, status: "ready", solution: { token: "secret-token" } }))
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key",
      reserve: reserve as never,
      register: register as never,
      fetch: fetcher,
      sleep,
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.capsolver.com/createTask")
    const createTaskRequest = fetcher.mock.calls[0]?.[1] as RequestInit | undefined
    expect(typeof createTaskRequest?.body).toBe("string")
    expect(JSON.parse(createTaskRequest?.body as string)).toMatchObject({
      clientKey: "secret-key",
      task: { type: "AntiTurnstileTaskProxyLess", websiteURL: params.url, websiteKey: "site-key" },
    })
    expect(register).toHaveBeenCalledWith({
      userId: "user-1", deepSearchJobId: "job-1", pageId: "page-1", taskId: "task-1",
    })
    expect(result).toEqual({ outcome: { status: "solved", family: "turnstile" }, token: "secret-token" })
  })

  it("never purchases again after a reservation without a known task ID", async () => {
    reserve.mockReturnValue({ created: false, taskId: null })
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(result).toEqual({ outcome: { status: "failed", reason: "attempt-already-reserved" } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("resumes a known task without creating another paid task", async () => {
    reserve.mockReturnValue({ created: false, taskId: "existing-task" })
    fetcher.mockResolvedValueOnce(response({ errorId: 0, status: "ready", solution: { token: "existing-token" } }))
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.capsolver.com/getTaskResult")
    expect(result.token).toBe("existing-token")
  })

  it("does not return credential or provider error details", async () => {
    fetcher.mockResolvedValueOnce(response({ errorId: 1, errorDescription: "secret-key token leaked" }))
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(JSON.stringify(result)).not.toContain("secret-key")
    expect(JSON.stringify(result)).not.toContain("leaked")
    expect(result.outcome).toEqual({ status: "failed", reason: "solver-failed" })
  })

  it("fails safely on an oversized createTask body and never repurchases on resume", async () => {
    const providerDetail = "provider-private-detail"
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      errorId: 0,
      taskId: "should-not-be-registered",
      errorDescription: providerDetail,
      padding: "x".repeat(256 * 1_024),
    })))
    const firstResult = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })

    expect(firstResult.outcome).toEqual({ status: "failed", reason: "solver-unavailable" })
    expect(register).not.toHaveBeenCalled()
    expect(JSON.stringify(firstResult)).not.toContain(providerDetail)
    expect(JSON.stringify(firstResult)).not.toContain("secret-key")

    reserve.mockReturnValue({ created: false, taskId: null })
    const resumedResult = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(resumedResult.outcome).toEqual({ status: "failed", reason: "attempt-already-reserved" })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("fails safely on an oversized getTaskResult body and resumes polling without repurchasing", async () => {
    const providerDetail = "provider-private-detail"
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorId: 0, taskId: "task-1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errorId: 0,
        status: "ready",
        solution: { token: "must-not-be-read" },
        errorDescription: providerDetail,
        padding: "x".repeat(256 * 1_024),
      })))
    const firstResult = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })

    expect(firstResult.outcome).toEqual({ status: "failed", reason: "solver-unavailable" })
    expect(register).toHaveBeenCalledOnce()
    expect(JSON.stringify(firstResult)).not.toContain(providerDetail)
    expect(JSON.stringify(firstResult)).not.toContain("secret-key")
    expect(JSON.stringify(firstResult)).not.toContain("must-not-be-read")

    reserve.mockReturnValue({ created: false, taskId: "task-1" })
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      errorId: 0, status: "ready", solution: { token: "resumed-token" },
    })))
    const resumedResult = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })

    expect(resumedResult.token).toBe("resumed-token")
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.capsolver.com/createTask",
      "https://api.capsolver.com/getTaskResult",
      "https://api.capsolver.com/getTaskResult",
    ])
  })

  it("stops before createTask when the workflow is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await solveCaptchaToken({ ...params, signal: controller.signal }, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.outcome.status).toBe("failed")
  })

  it("rejects blank provider task IDs without registering or polling them", async () => {
    fetcher.mockResolvedValueOnce(response({ errorId: 0, taskId: "   " }))
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(result.outcome).toEqual({ status: "failed", reason: "solver-failed" })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
  })

  it("lets the provider report an expired task and never creates a replacement", async () => {
    reserve.mockReturnValue({ created: false, taskId: "expired-task" })
    fetcher.mockResolvedValueOnce(response({ errorId: 1, errorCode: "ERROR_TASKID_INVALID" }))
    const result = await solveCaptchaToken(params, {
      apiKey: "secret-key", reserve: reserve as never, register: register as never, fetch: fetcher,
    })
    expect(result.outcome).toEqual({ status: "failed", reason: "solver-failed" })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.capsolver.com/getTaskResult")
  })
})
