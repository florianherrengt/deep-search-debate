import {
  constants,
  type FileHandle,
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenAiCodexError } from "../codexErrors.ts"
import { codexLoginConfig } from "./policy.ts"
import { terminateApiForUnreapedCodexProcess } from "./process.ts"

const SESSION_PREFIX = "rethinkloop-codex-"
const MAX_CREDENTIAL_BYTES = 1024 * 1024

export type CodexHome = {
  root: string
  home: string
  work: string
  control: string
  rootIdentity: { dev: bigint; ino: bigint }
}

async function tempBase(): Promise<string> {
  if (process.platform === "linux") {
    try {
      await access("/dev/shm", constants.R_OK | constants.W_OK | constants.X_OK)
      return "/dev/shm"
    } catch {
      // A minimal container may not mount /dev/shm. The hardened launcher
      // still constrains a disk-backed /tmp fallback to this one session.
    }
  }
  return tmpdir()
}

export async function createCodexHome(
  credentials?: Buffer,
): Promise<CodexHome> {
  const root = await mkdtemp(path.join(await tempBase(), SESSION_PREFIX))
  try {
    await chmod(root, 0o700)
    const home = path.join(root, "home")
    const work = path.join(root, "work")
    const control = path.join(root, "control")
    await Promise.all([
      mkdir(home, { mode: 0o700 }),
      mkdir(work, { mode: 0o700 }),
      mkdir(control, { mode: 0o700 }),
    ])
    await writeFile(path.join(home, "config.toml"), codexLoginConfig, {
      mode: 0o600,
      flag: "wx",
    })
    if (credentials) {
      await writeFile(path.join(home, "auth.json"), credentials, {
        mode: 0o600,
        flag: "wx",
      })
    }
    const rootStat = await stat(root, { bigint: true })
    return {
      root,
      home,
      work,
      control,
      rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
    }
  } catch (error) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      terminateApiForUnreapedCodexProcess()
    }
    throw error
  }
}

async function verifyHomeRoot(home: CodexHome): Promise<void> {
  const rootPath = await realpath(home.root)
  const allowedBases = [await realpath(tmpdir())]
  if (process.platform === "linux") {
    try {
      allowedBases.push(await realpath("/dev/shm"))
    } catch {
      // The home could only have been created under an available base.
    }
  }
  if (
    !allowedBases.some(
      (base) =>
        path.dirname(rootPath) === base &&
        path.basename(rootPath).startsWith(SESSION_PREFIX),
    )
  ) {
    throw new Error("Refusing to operate on an unexpected Codex home")
  }
  const rootStat = await stat(rootPath, { bigint: true })
  if (
    rootStat.dev !== home.rootIdentity.dev ||
    rootStat.ino !== home.rootIdentity.ino ||
    !rootStat.isDirectory()
  ) {
    throw new Error("Codex home identity changed while it was active")
  }
}

export async function readCodexCredentials(
  home: CodexHome,
): Promise<Buffer> {
  await verifyHomeRoot(home)
  const credentialPath = path.join(home.home, "auth.json")

  let handle: FileHandle | undefined
  try {
    handle = await open(
      credentialPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const credentialStat = await handle.stat({ bigint: true })
    const unsafeMode = Number(credentialStat.mode & 0o077n)
    if (
      !credentialStat.isFile() ||
      credentialStat.nlink !== 1n ||
      credentialStat.uid !== BigInt(process.getuid?.() ?? credentialStat.uid) ||
      unsafeMode !== 0 ||
      credentialStat.size <= 0n ||
      credentialStat.size > BigInt(MAX_CREDENTIAL_BYTES)
    ) {
      throw new OpenAiCodexError("authentication-required")
    }
    return await readFile(handle)
  } catch (error) {
    if (error instanceof OpenAiCodexError) throw error
    throw new OpenAiCodexError("authentication-required")
  } finally {
    await handle?.close()
  }
}

export async function removeCodexHome(home: CodexHome): Promise<void> {
  await verifyHomeRoot(home)
  await rm(home.root, { recursive: true, force: true, maxRetries: 3 })
}
