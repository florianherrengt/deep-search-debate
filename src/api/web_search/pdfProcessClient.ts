import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { PdfTextExtraction } from "./pdfText.ts"
import { throwIfAborted } from "./pdfText.ts"
import type { PdfProcessRequest } from "./pdfProcessProtocol.ts"

const PDF_PROCESS_MAX_OLD_GENERATION_MB = 128
const PDF_PROCESS_MAX_YOUNG_GENERATION_MB = 32

export interface PdfProcessHandle {
  kill(signal: NodeJS.Signals): boolean
  off(event: "error", listener: (error: Error) => void): this
  off(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  off(event: "message", listener: (message: unknown) => void): this
  once(event: "error", listener: (error: Error) => void): this
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: "message", listener: (message: unknown) => void): this
  send(message: PdfProcessRequest, callback: (error: Error | null) => void): boolean
}

type PdfProcessFactory = () => PdfProcessHandle
type ExtractPdfInProcessInput = {
  bytes: Uint8Array
  maxPages: number
  maxTextChars: number
  signal?: AbortSignal
  timeoutMs: number
}

function createPdfProcess(): PdfProcessHandle {
  return fork(fileURLToPath(new URL("./pdfProcess.ts", import.meta.url)), {
    execArgv: [
      "--experimental-strip-types",
      `--max-old-space-size=${PDF_PROCESS_MAX_OLD_GENERATION_MB}`,
      `--max-semi-space-size=${PDF_PROCESS_MAX_YOUNG_GENERATION_MB}`,
    ],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
}

/** Runs untrusted PDF.js work in a child process and kills it on every outcome. */
export async function extractPdfInProcess(
  input: ExtractPdfInProcessInput,
  processFactory: PdfProcessFactory = createPdfProcess,
): Promise<PdfTextExtraction> {
  throwIfAborted(input.signal)
  const child = processFactory()

  return new Promise<PdfTextExtraction>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", onAbort)
      child.off("message", onMessage)
      child.off("error", onError)
      child.off("exit", onExit)
    }
    const stopProcess = (action: () => void) => {
      const onStopped = () => action()
      child.once("exit", onStopped)
      try {
        if (child.kill("SIGKILL")) return
      } catch {
        // A failed or already-exited spawn has no process left to terminate.
      }
      child.off("exit", onStopped)
      action()
    }
    const settle = (action: () => void, processAlreadyStopped = false) => {
      if (settled) return
      settled = true
      cleanup()
      if (processAlreadyStopped) action()
      else stopProcess(action)
    }
    const onMessage = (message: unknown) => settle(() => resolve(message as PdfTextExtraction))
    const onError = (error: Error) => settle(() => reject(error))
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`
      settle(() => reject(new Error(`PDF parser exited before responding (${reason})`)), true)
    }
    const onAbort = () => {
      try {
        throwIfAborted(input.signal)
      } catch (error) {
        const abortError = error instanceof Error ? error : new Error(String(error))
        settle(() => reject(abortError))
      }
    }
    const timeout = setTimeout(() => settle(() => reject(new Error("PDF parsing timed out"))), input.timeoutMs)

    child.once("message", onMessage)
    child.once("error", onError)
    child.once("exit", onExit)
    input.signal?.addEventListener("abort", onAbort, { once: true })

    const request: PdfProcessRequest = {
      bytes: input.bytes.slice().buffer,
      maxPages: input.maxPages,
      maxTextChars: input.maxTextChars,
    }
    try {
      child.send(request, (error) => {
        if (error) settle(() => reject(error))
      })
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}
