#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { open, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"

const API_BASE_PORT = 3000
const WEB_BASE_PORT = 5173

function usage() {
  console.log(`Usage: npm run worktree:create -- <branch> [start-point]

Creates or attaches <branch> under .worktrees/ and writes isolated API and
Vite port configuration. The optional start point is valid only for a new
branch and defaults to the current commit.`)
}

function gitOutput(arguments_, cwd) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function gitSucceeds(arguments_, cwd) {
  return spawnSync("git", arguments_, {
    cwd,
    stdio: "ignore",
  }).status === 0
}

function worktreeForBranch(branch, cwd) {
  const records = gitOutput(
    ["worktree", "list", "--porcelain", "-z"],
    cwd,
  ).split("\0\0")

  for (const record of records) {
    const fields = record.split("\0")
    if (!fields.includes(`branch refs/heads/${branch}`)) continue

    const worktree = fields.find((field) => field.startsWith("worktree "))
    if (worktree !== undefined) return worktree.slice("worktree ".length)
  }

  throw new Error(
    `The ${branch} branch must be checked out in a worktree so its .env can be copied`,
  )
}

function destinationName(branch) {
  return branch.replaceAll("/", "-").replace(/[^a-zA-Z0-9._-]/g, "-")
}

function envValue(contents, name) {
  const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`)

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(pattern)
    if (match === null) continue

    return match[1]?.trim().replace(/^(['"])(.*)\1$/, "$2")
  }

  return undefined
}

function withEnvValues(contents, values) {
  const remaining = new Map(Object.entries(values))
  const result = []

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)
    const name = match?.[1]

    if (name !== undefined && remaining.has(name)) {
      result.push(`${name}=${remaining.get(name)}`)
      remaining.delete(name)
    } else {
      result.push(line)
    }
  }

  while (result.at(-1) === "") result.pop()
  for (const [name, value] of remaining) result.push(`${name}=${value}`)

  return `${result.join("\n")}\n`
}

async function optionalFile(path) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

async function collectReservedPorts(worktreesRoot) {
  const apiPorts = new Set([API_BASE_PORT])
  const webPorts = new Set([WEB_BASE_PORT])
  const entries = await readdir(worktreesRoot, { withFileTypes: true })

  await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const worktree = join(worktreesRoot, entry.name)
      const [apiEnvironment, webEnvironment] = await Promise.all([
        optionalFile(join(worktree, "src/api/.env")),
        optionalFile(join(worktree, "src/web/.env")),
      ])
      const apiPort = Number(envValue(apiEnvironment ?? "", "PORT"))
      const webPort = Number(envValue(webEnvironment ?? "", "VITE_PORT"))

      if (Number.isInteger(apiPort)) apiPorts.add(apiPort)
      if (Number.isInteger(webPort)) webPorts.add(webPort)
    }),
  )

  return { apiPorts, webPorts }
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function allocatePorts(worktreesRoot) {
  const { apiPorts, webPorts } = await collectReservedPorts(worktreesRoot)

  for (let offset = 1; WEB_BASE_PORT + offset <= 65_535; offset += 1) {
    const apiPort = API_BASE_PORT + offset
    const webPort = WEB_BASE_PORT + offset
    if (apiPorts.has(apiPort) || webPorts.has(webPort)) continue

    const [apiAvailable, webAvailable] = await Promise.all([
      portIsAvailable(apiPort),
      portIsAvailable(webPort),
    ])
    if (apiAvailable && webAvailable) return { apiPort, webPort }
  }

  throw new Error("No free API/Vite port pair is available")
}

async function createWorktree(branch, startPoint) {
  const currentRoot = gitOutput(["rev-parse", "--show-toplevel"], process.cwd())
  const mainWorktreeRoot = worktreeForBranch("main", currentRoot)
  const worktreesRoot = join(mainWorktreeRoot, ".worktrees")

  if (!gitSucceeds(["check-ref-format", "--branch", branch], currentRoot)) {
    throw new Error(`Invalid branch name: ${branch}`)
  }

  const branchExists = gitSucceeds(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    currentRoot,
  )
  if (branchExists && startPoint !== undefined) {
    throw new Error("A start point cannot be supplied for an existing branch")
  }

  const worktreePath = join(worktreesRoot, destinationName(branch))
  await mkdir(worktreesRoot, { recursive: true })
  const lockPath = join(worktreesRoot, ".create.lock")
  let lock

  try {
    lock = await open(lockPath, "wx", 0o600)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `Another worktree creation is active. If not, remove the stale lock at ${lockPath}`,
      )
    }
    throw error
  }

  try {
    const { apiPort, webPort } = await allocatePorts(worktreesRoot)
    const sourceApiEnvironment = await optionalFile(
      join(mainWorktreeRoot, "src/api/.env"),
    )
    if (sourceApiEnvironment === undefined) {
      throw new Error(
        `Missing ${join(mainWorktreeRoot, "src/api/.env")}; create the main worktree's environment file first`,
      )
    }
    const apiEnvironment = withEnvValues(
      sourceApiEnvironment,
      {
        PORT: String(apiPort),
        BETTER_AUTH_URL: `http://localhost:${webPort}`,
      },
    )
    const sourceWebEnvironment = await optionalFile(
      join(mainWorktreeRoot, "src/web/.env"),
    )
    const webEnvironment = withEnvValues(
      sourceWebEnvironment ??
        (await readFile(join(mainWorktreeRoot, "src/web/.env.example"), "utf8")),
      {
        VITE_PORT: String(webPort),
        VITE_API_TARGET: `http://localhost:${apiPort}`,
      },
    )

    const worktreeArguments = ["worktree", "add"]
    if (branchExists) {
      worktreeArguments.push(worktreePath, branch)
    } else {
      const baseCommit = gitOutput(
        ["rev-parse", "--verify", `${startPoint ?? "HEAD"}^{commit}`],
        currentRoot,
      )
      worktreeArguments.push("-b", branch, worktreePath, baseCommit)
    }

    execFileSync("git", worktreeArguments, {
      cwd: currentRoot,
      stdio: "inherit",
    })
    await Promise.all([
      writeFile(join(worktreePath, "src/api/.env"), apiEnvironment, {
        mode: 0o600,
      }),
      writeFile(join(worktreePath, "src/web/.env"), webEnvironment, {
        mode: 0o600,
      }),
    ])

    console.log(`\nWorktree: ${worktreePath}`)
    console.log(`Branch:   ${branch}`)
    console.log(`API:      http://localhost:${apiPort}`)
    console.log(`Web:      http://localhost:${webPort}`)
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

const [branch, startPoint, ...extraArguments] = process.argv.slice(2)

if (branch === "--help" || branch === "-h") {
  usage()
} else if (branch === undefined || extraArguments.length > 0) {
  usage()
  process.exitCode = 1
} else {
  createWorktree(branch, startPoint).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
