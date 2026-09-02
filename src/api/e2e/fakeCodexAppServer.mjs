#!/usr/bin/env node

/** Deterministic Codex 0.149.1 stdio app-server used by Playwright. */

import { env, exit, stdin, stdout } from "node:process"
import { createInterface } from "node:readline"
import { createFakeCodexAuth } from "./fakeCodexAppServer/auth.mjs"
import { createFakeCodexGeneration } from "./fakeCodexAppServer/generation.mjs"

const codexHome = env.CODEX_HOME
if (!codexHome) throw new Error("CODEX_HOME is required")

function writeMessage(message) {
  stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  writeMessage({ id, result })
}

function fail(id, message, code = -32000) {
  writeMessage({ id, error: { code, message } })
}

function notify(method, params) {
  writeMessage({ method, params })
}

const transport = { fail, notify, respond }
const auth = createFakeCodexAuth({ codexHome, ...transport })
const generation = createFakeCodexGeneration({
  ...transport,
  isLoggedIn: auth.isLoggedIn,
})

function handleRequest(message) {
  const { id, method } = message
  const params = message.params ?? {}
  if (id === undefined || id === null) return

  if (method === "initialize") {
    respond(id, {
      userAgent: "codex-cli/0.149.1",
      codexHome,
      platformFamily: "unix",
      platformOs: "linux",
      capabilities: { modelList: true },
    })
    return
  }
  if (auth.handle(method, id, params)) return
  if (generation.handle(method, id, params)) return
  fail(id, `method not found: ${method}`, -32601)
}

const lines = createInterface({ input: stdin, crlfDelay: Infinity })
lines.on("line", (line) => {
  try {
    handleRequest(JSON.parse(line))
  } catch {
    // Ignore malformed client input in the deterministic fixture.
  }
})

function shutdown() {
  auth.shutdown()
  exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
