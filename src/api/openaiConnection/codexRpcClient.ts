import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import path from "node:path"
import z from "zod"
import { config } from "../config.ts"
import { classifyCodexError, OpenAiCodexError } from "./codexErrors.ts"
import type { CodexHome } from "./codexSession/home.ts"
import {
  codexProcessEnvironment,
  getCodexExecutablePath,
  reapCodexProcessGroup,
  terminateApiForUnreapedCodexProcess,
} from "./codexSession/process.ts"

const jsonRpcResponseSchema = z.union([
  z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() }),
  z.object({
    id: z.union([z.string(), z.number()]).nullable(),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
])

const jsonRpcNotificationSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
})

const MAX_JSON_RPC_LINE_BYTES = 1024 * 1024

export const deviceLoginResultSchema = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.string().min(1).max(256),
  verificationUrl: z.url({ protocol: /^https$/ }).max(2_048),
  userCode: z.string().min(1).max(128),
})

export const loginCompletedSchema = z.object({
  loginId: z.string().nullable(),
  success: z.boolean(),
  error: z.string().nullable(),
})

export const accountReadSchema = z.object({
  account: z
    .object({
      type: z.string(),
    })
    .nullable(),
})

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

type NotificationHandler = (params: unknown) => void | Promise<void>

function spawnCommand(executablePath: string): {
  command: string
  args: string[]
} {
  return [".js", ".mjs", ".cjs"].includes(path.extname(executablePath))
    ? { command: process.execPath, args: [executablePath] }
    : { command: executablePath, args: [] }
}

export class CodexRpcClient {
  private readonly home: CodexHome
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notificationHandlers = new Map<
    string,
    Set<NotificationHandler>
  >()
  private child: ChildProcessWithoutNullStreams | undefined
  private stdoutBuffer = Buffer.alloc(0)
  private nextId = 1
  private closed = false
  private closePromise: Promise<void> | undefined

  constructor(home: CodexHome) {
    this.home = home
  }

  async start(): Promise<void> {
    if (this.child) return
    const executablePath = getCodexExecutablePath()
    const command = spawnCommand(executablePath)
    const child = spawn(
      command.command,
      [...command.args, "app-server", "--listen", "stdio://"],
      {
        cwd: this.home.work,
        env: {
          ...codexProcessEnvironment(this.home),
          PATH: "/usr/bin:/bin",
          RUST_LOG: "error",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    this.child = child
    child.stderr.on("data", () => undefined)
    child.stdin.on("error", () => {
      this.rejectAll(new OpenAiCodexError("temporarily-unavailable"))
    })
    child.on("error", () => {
      this.rejectAll(new OpenAiCodexError("temporarily-unavailable"))
    })
    child.on("exit", () => {
      if (!this.closed) {
        this.rejectAll(new OpenAiCodexError("temporarily-unavailable"))
      }
    })
    child.stdout.on("data", (chunk: Buffer | string) => {
      this.handleStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    await this.request(
      "initialize",
      {
        clientInfo: {
          name: "rethinkloop",
          title: "RethinkLoop",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: false },
      },
      z.object({ codexHome: z.string() }),
    )
    this.notify("initialized", {})
  }

  on(method: string, handler: NotificationHandler): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set()
    handlers.add(handler)
    this.notificationHandlers.set(method, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.notificationHandlers.delete(method)
    }
  }

  async request<Schema extends z.ZodType>(
    method: string,
    params: unknown,
    schema: Schema,
    timeoutMs = config.llmExecution.firstChunkTimeoutMs,
  ): Promise<z.output<Schema>> {
    if (!this.child?.stdin.writable || this.closed) {
      throw new OpenAiCodexError("temporarily-unavailable")
    }
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new OpenAiCodexError("timeout"))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    try {
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    } catch {
      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(new OpenAiCodexError("temporarily-unavailable"))
      }
    }
    try {
      return schema.parse(await result)
    } catch (error) {
      throw classifyCodexError(error)
    }
  }

  notify(method: string, params: unknown): void {
    if (!this.child?.stdin.writable || this.closed) return
    try {
      this.child.stdin.write(`${JSON.stringify({ method, params })}\n`)
    } catch {
      this.rejectAll(new OpenAiCodexError("temporarily-unavailable"))
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeInternal()
    return this.closePromise
  }

  private async closeInternal(): Promise<void> {
    this.closed = true
    this.rejectAll(new OpenAiCodexError("temporarily-unavailable"))
    const child = this.child
    this.child = undefined
    this.stdoutBuffer = Buffer.alloc(0)
    if (!child) return
    try {
      child.kill("SIGTERM")
      await Promise.race([
        once(child, "close"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ])
    } catch {
      // A failed graceful close is safe only if the authoritative group reap
      // below proves that no process remains.
    }
    try {
      await reapCodexProcessGroup(this.home)
    } catch {
      terminateApiForUnreapedCodexProcess()
    }
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    let newline = this.stdoutBuffer.indexOf(0x0a)
    while (newline !== -1) {
      if (newline > MAX_JSON_RPC_LINE_BYTES) {
        void this.close()
        return
      }
      const line = this.stdoutBuffer.subarray(0, newline).toString("utf8")
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      this.handleLine(line.endsWith("\r") ? line.slice(0, -1) : line)
      newline = this.stdoutBuffer.indexOf(0x0a)
    }
    if (this.stdoutBuffer.byteLength > MAX_JSON_RPC_LINE_BYTES) {
      void this.close()
    }
  }

  private handleLine(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return
    }
    const response = jsonRpcResponseSchema.safeParse(value)
    if (response.success) {
      if (response.data.id === null) return
      const id = Number(response.data.id)
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      if ("error" in response.data) {
        pending.reject(classifyCodexError(response.data.error.message))
      } else {
        pending.resolve(response.data.result)
      }
      return
    }
    const notification = jsonRpcNotificationSchema.safeParse(value)
    if (!notification.success) return
    for (const handler of this.notificationHandlers.get(
      notification.data.method,
    ) ?? []) {
      void Promise.resolve(handler(notification.data.params)).catch(() => {
        // Notification failures are converted by the owning state machine.
      })
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
