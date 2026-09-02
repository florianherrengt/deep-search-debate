import { readFile } from "node:fs/promises"
import path from "node:path"
import { config } from "../../config.ts"
import { OpenAiCodexError } from "../codexErrors.ts"
import type { CodexHome } from "./home.ts"

const PRODUCTION_LAUNCHER = "/usr/local/bin/rethinkloop-codex"

export class FatalCodexContainmentError extends Error {
  override readonly name = "FatalCodexContainmentError"

  constructor() {
    super("Codex process exit could not be proven; terminating the API process")
  }
}

/**
 * A live Codex process must never outlive its credential home or process slot.
 * Request termination of the API process so the container runtime can contain
 * the unknown child state, then throw to stop all caller cleanup immediately.
 */
export function terminateApiForUnreapedCodexProcess(): never {
  try {
    process.kill(process.pid, "SIGTERM")
  } catch {
    throw new FatalCodexContainmentError()
  }
  throw new FatalCodexContainmentError()
}

export function getCodexExecutablePath(): string {
  return config.openAiCodex.executablePath ?? PRODUCTION_LAUNCHER
}

export function codexProcessEnvironment(
  home: CodexHome,
): Record<string, string> {
  return {
    HOME: home.home,
    CODEX_HOME: home.home,
    TMPDIR: home.work,
    RETHINKLOOP_CODEX_CONTROL_DIR: home.control,
  }
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )
  }
}

async function waitForGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(processGroupId)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !processGroupExists(processGroupId)
}

async function readProcessGroupId(home: CodexHome): Promise<number | undefined> {
  try {
    const raw = await readFile(path.join(home.control, "pid"), "utf8")
    if (!/^[1-9][0-9]{0,9}\n?$/.test(raw)) return
    const value = Number.parseInt(raw, 10)
    return Number.isSafeInteger(value) && value > 1 ? value : undefined
  } catch {
    return
  }
}

/** Waits for every process in the launcher's isolated group before home sync. */
export async function reapCodexProcessGroup(home: CodexHome): Promise<void> {
  const processGroupId = await readProcessGroupId(home)
  if (processGroupId === undefined) {
    if (config.environment === "production") {
      throw new OpenAiCodexError("temporarily-unavailable")
    }
    return
  }
  if (await waitForGroupExit(processGroupId, 2_000)) return
  try {
    process.kill(-processGroupId, "SIGTERM")
  } catch {
    // The group may have exited between the check and signal.
  }
  if (await waitForGroupExit(processGroupId, 1_000)) return
  try {
    process.kill(-processGroupId, "SIGKILL")
  } catch {
    // The group may have exited between the check and signal.
  }
  if (!(await waitForGroupExit(processGroupId, 1_000))) {
    throw new OpenAiCodexError("temporarily-unavailable")
  }
}
