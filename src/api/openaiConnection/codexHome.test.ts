import {
  chmod,
  lstat,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createdRoots: [] as string[],
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    mkdtemp: fsMocks.mkdtemp,
    rm: fsMocks.rm,
    stat: fsMocks.stat,
  }
})

const actualFs = await vi.importActual<typeof import("node:fs/promises")>(
  "node:fs/promises",
)

import {
  createCodexHome,
  readCodexCredentials,
  removeCodexHome,
  type CodexHome,
} from "./codexSession/home.ts"
import {
  codexProcessEnvironment,
  FatalCodexContainmentError,
  terminateApiForUnreapedCodexProcess,
} from "./codexSession/process.ts"

const cleanupPaths = new Set<string>()

beforeEach(() => {
  vi.clearAllMocks()
  fsMocks.createdRoots.length = 0
  fsMocks.mkdtemp.mockImplementation(async (prefix: string) => {
    const root = await actualFs.mkdtemp(prefix)
    fsMocks.createdRoots.push(root)
    return root
  })
  fsMocks.rm.mockImplementation(actualFs.rm)
  fsMocks.stat.mockImplementation(actualFs.stat)
})

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map((target) =>
      actualFs.rm(target, { force: true, recursive: true }),
    ),
  )
  cleanupPaths.clear()
})

describe("ephemeral Codex homes", () => {
  it("requests API termination before raising fatal containment", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)

    expect(() => terminateApiForUnreapedCodexProcess()).toThrow(
      FatalCodexContainmentError,
    )
    expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGTERM")

    kill.mockRestore()
  })

  it("creates a private home with only the intended process environment", async () => {
    const credentials = Buffer.from('{"tokens":{"access":"private"}}')
    const home = await createCodexHome(credentials)
    cleanupPaths.add(home.root)

    for (const directory of [home.root, home.home, home.work, home.control]) {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700)
    }
    for (const filename of ["config.toml", "auth.json"]) {
      expect((await lstat(path.join(home.home, filename))).mode & 0o777).toBe(
        0o600,
      )
    }
    await expect(readCodexCredentials(home)).resolves.toEqual(credentials)
    expect(codexProcessEnvironment(home)).toEqual({
      HOME: home.home,
      CODEX_HOME: home.home,
      TMPDIR: home.work,
      RETHINKLOOP_CODEX_CONTROL_DIR: home.control,
    })

    await removeCodexHome(home)
    cleanupPaths.delete(home.root)
    await expect(lstat(home.root)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("requests fatal containment when partial-home rollback cannot delete credentials", async () => {
    const creationFailure = new Error("final home stat failed")
    fsMocks.stat.mockRejectedValueOnce(creationFailure)
    fsMocks.rm.mockRejectedValueOnce(new Error("rollback deletion failed"))
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)

    await expect(
      createCodexHome(Buffer.from('{"tokens":{"access":"private"}}')),
    ).rejects.toBeInstanceOf(FatalCodexContainmentError)

    const root = fsMocks.createdRoots.at(-1)
    if (!root) throw new Error("Expected a partial Codex home")
    cleanupPaths.add(root)
    await expect(readFile(path.join(root, "home", "auth.json"), "utf8")).resolves
      .toBe('{"tokens":{"access":"private"}}')
    expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGTERM")
    expect(fsMocks.rm).toHaveBeenCalledExactlyOnceWith(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
    })

    kill.mockRestore()
  })

  it("preserves the creation failure after successful partial-home rollback", async () => {
    const creationFailure = new Error("final home stat failed")
    fsMocks.stat.mockRejectedValueOnce(creationFailure)

    await expect(createCodexHome(Buffer.from("credentials"))).rejects.toBe(
      creationFailure,
    )

    const root = fsMocks.createdRoots.at(-1)
    if (!root) throw new Error("Expected a partial Codex home")
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("refuses to read credentials through a symbolic link", async () => {
    const home = await createCodexHome(Buffer.from("original"))
    cleanupPaths.add(home.root)
    const outside = await actualFs.mkdtemp(
      path.join(tmpdir(), "codex-secret-target-"),
    )
    cleanupPaths.add(outside)
    const outsideCredential = path.join(outside, "auth.json")
    await writeFile(outsideCredential, "outside-secret", { mode: 0o600 })
    const credentialPath = path.join(home.home, "auth.json")
    await unlink(credentialPath)
    await symlink(outsideCredential, credentialPath)

    await expect(readCodexCredentials(home)).rejects.toMatchObject({
      code: "authentication-required",
    })
    await expect(readFile(outsideCredential, "utf8")).resolves.toBe(
      "outside-secret",
    )
  })

  it("refuses cleanup when the recorded root identity is stale", async () => {
    const home = await createCodexHome(Buffer.from("credentials"))
    cleanupPaths.add(home.root)
    const staleHome: CodexHome = {
      ...home,
      rootIdentity: {
        ...home.rootIdentity,
        ino: home.rootIdentity.ino + 1n,
      },
    }

    await expect(removeCodexHome(staleHome)).rejects.toThrow(
      "Codex home identity changed while it was active",
    )
    expect((await lstat(home.root)).isDirectory()).toBe(true)

    // The valid identity can still clean up the directory.
    await chmod(home.root, 0o700)
    await removeCodexHome(home)
    cleanupPaths.delete(home.root)
  })
})
