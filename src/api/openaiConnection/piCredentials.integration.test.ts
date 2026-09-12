import { createModels } from "@earendil-works/pi-ai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/index.ts"
import { openAiCodexConnections } from "../db/schema/index.ts"
import { testUserId } from "../db/testSetup.ts"
import { startPiLlmStream } from "../llms/piGeneration.ts"
import { listAvailableCodexModels } from "./codexGeneration.ts"
import {
  deleteOpenAiCodexConnectionForUser,
  getOpenAiCodexConnection,
  replaceOpenAiCodexConnection,
} from "./credentialsRepository.ts"
import { PI_CODEX_PROVIDER_ID, PiCodexCredentialStore } from "./piCredentials.ts"

const now = Date.parse("2026-09-08T12:00:00Z")
const accountId = "synthetic-account"
const fetch = vi.fn<typeof globalThis.fetch>()

function accessToken(exp: unknown) {
  const payload = Buffer.from(JSON.stringify({
    exp,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url")
  return `test.${payload}.signature`
}

function legacyCredential(access = accessToken(now / 1000 + 3600)) {
  return {
    tokens: {
      access_token: access,
      refresh_token: "synthetic-legacy-refresh",
      account_id: accountId,
    },
    last_refresh: "2026-09-04T12:00:00Z",
  }
}

function modelsForUser() {
  const models = createModels({
    credentials: new PiCodexCredentialStore(testUserId),
  })
  models.setProvider(openaiCodexProvider())
  return models
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(now)
  fetch.mockReset().mockRejectedValue(new Error("Unexpected outbound request"))
  vi.stubGlobal("fetch", fetch)
})

afterEach(() => {
  db.delete(openAiCodexConnections).run()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("persisted Codex credential compatibility", () => {
  it.each([undefined, "chatgpt"])(
    "uses an unexpired legacy connection with auth_mode %s without changing its encrypted row",
    async (authMode) => {
      const legacy = { ...legacyCredential(), auth_mode: authMode }
      const encoded = Buffer.from(JSON.stringify(legacy))
      replaceOpenAiCodexConnection(testUserId, encoded)
      const before = db.select().from(openAiCodexConnections).get()

      await expect(modelsForUser().getAuth(PI_CODEX_PROVIDER_ID))
        .resolves.toMatchObject({
          source: "OAuth",
          auth: { apiKey: legacy.tokens.access_token },
        })

      expect(fetch).not.toHaveBeenCalled()
      expect(db.select().from(openAiCodexConnections).get()).toEqual(before)
      expect(getOpenAiCodexConnection(testUserId)?.credentials).toEqual(encoded)
      expect(db.$client.serialize().includes(encoded)).toBe(false)
    },
  )

  it("refreshes expired legacy credentials and reloads the rotated Pi credential without another request", async () => {
    const legacy = legacyCredential(accessToken(now / 1000 - 60))
    replaceOpenAiCodexConnection(testUserId, Buffer.from(JSON.stringify(legacy)))
    const connectionId = getOpenAiCodexConnection(testUserId)?.connectionId
    const rotatedAccess = accessToken(now / 1000 + 3600)
    const rotatedRefresh = "synthetic-rotated-refresh"
    fetch.mockImplementationOnce(async (input, init) => {
      const request = new Request(input, init)
      expect(request.url).toBe("https://auth.openai.com/oauth/token")
      expect(request.method).toBe("POST")
      const form = new URLSearchParams(await request.text())
      expect(form.get("grant_type")).toBe("refresh_token")
      expect(form.get("refresh_token")).toBe(legacy.tokens.refresh_token)
      return Response.json({
        access_token: rotatedAccess,
        refresh_token: rotatedRefresh,
        expires_in: 3600,
      })
    })

    await expect(modelsForUser().getAuth(PI_CODEX_PROVIDER_ID))
      .resolves.toMatchObject({ auth: { apiKey: rotatedAccess } })

    const expected = {
      type: "oauth",
      access: rotatedAccess,
      refresh: rotatedRefresh,
      expires: now + 3_600_000,
      accountId,
    }
    const saved = getOpenAiCodexConnection(testUserId)
    expect(saved?.connectionId).toBe(connectionId)
    expect(JSON.parse(saved?.credentials.toString("utf8") ?? "null"))
      .toEqual(expected)
    expect(db.$client.serialize().includes(Buffer.from(rotatedRefresh))).toBe(false)
    await expect(new PiCodexCredentialStore(testUserId).read(PI_CODEX_PROVIDER_ID))
      .resolves.toEqual(expected)
    await expect(modelsForUser().getAuth(PI_CODEX_PROVIDER_ID))
      .resolves.toMatchObject({ auth: { apiKey: rotatedAccess } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ["missing tokens", JSON.stringify({ last_refresh: "synthetic-private-metadata" })],
    ["malformed JSON", '{"tokens":"synthetic-private-metadata"'],
    ["malformed JWT", JSON.stringify(legacyCredential("synthetic-private-token"))],
    ["missing JWT expiry", JSON.stringify(legacyCredential(accessToken(undefined)))],
    ["string JWT expiry", JSON.stringify(legacyCredential(accessToken("1900000000")))],
    ["non-positive JWT expiry", JSON.stringify(legacyCredential(accessToken(0)))],
    ["non-finite JWT expiry", JSON.stringify(legacyCredential(
      `test.${Buffer.from('{"exp":1e400}').toString("base64url")}.signature`,
    ))],
    ["invalid current payload with valid legacy fields", JSON.stringify({
      ...legacyCredential(),
      type: "oauth",
      access: "synthetic-private-token",
    })],
  ])("rejects %s safely through Pi without attempting authentication", async (_name, raw) => {
    replaceOpenAiCodexConnection(testUserId, Buffer.from(raw))
    const before = db.select().from(openAiCodexConnections).get()
    let failure: unknown
    try {
      await listAvailableCodexModels(testUserId)
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      name: "OpenAiCodexError",
      code: "protocol-incompatible",
    })
    expect(failure).toSatisfy(
      (error: Error) => !error.message.includes("synthetic") &&
        !error.message.includes("expired") && error.cause === undefined,
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(db.select().from(openAiCodexConnections).get()).toEqual(before)
  })

  it("preserves credential incompatibility when Pi flattens an actual stream error", async () => {
    replaceOpenAiCodexConnection(testUserId, Buffer.from(JSON.stringify(
      legacyCredential("synthetic-private-invalid-token"),
    )))
    const models = modelsForUser()
    const model = models.getModel(PI_CODEX_PROVIDER_ID, "gpt-5.6-sol")
    if (!model) throw new Error("Expected the configured Codex model")
    const started = startPiLlmStream(
      { models, model, provider: "codex", reasoningEffort: "low" },
      { system: "Synthetic test", prompt: "Synthetic test" },
    )
    const parts = []

    for await (const part of started.stream) parts.push(part)

    expect(fetch).not.toHaveBeenCalled()
    expect(parts).toMatchObject([{
      type: "error",
      error: {
        name: "OpenAiCodexError",
        code: "protocol-incompatible",
        message: "This OpenAI connection is not compatible with the current Codex integration. Try connecting again later.",
      },
    }])
    await expect(started.finishReason).resolves.toBe("error")
  })

  it.each(["disconnect", "reconnect"])(
    "does not overwrite a concurrent %s when a legacy refresh finishes",
    async (action) => {
      replaceOpenAiCodexConnection(testUserId, Buffer.from(JSON.stringify(
        legacyCredential(accessToken(now / 1000 - 60)),
      )))
      const replacementAccess = accessToken(now / 1000 + 7200)
      const replacement = {
        type: "oauth",
        access: replacementAccess,
        refresh: "synthetic-reconnected-refresh",
        expires: now + 7_200_000,
        accountId,
      }
      fetch.mockImplementationOnce(() => {
        // Model a connection changed by another process while OAuth is in flight.
        deleteOpenAiCodexConnectionForUser(testUserId)
        if (action === "reconnect") {
          replaceOpenAiCodexConnection(testUserId, Buffer.from(JSON.stringify(replacement)))
        }
        return Promise.resolve(Response.json({
          access_token: accessToken(now / 1000 + 3600),
          refresh_token: "synthetic-stale-refresh",
          expires_in: 3600,
        }))
      })

      const auth = await modelsForUser().getAuth(PI_CODEX_PROVIDER_ID)

      expect(auth).toEqual(action === "disconnect" ? undefined : {
        source: "OAuth",
        auth: { apiKey: replacementAccess },
      })
      await expect(new PiCodexCredentialStore(testUserId).read(PI_CODEX_PROVIDER_ID))
        .resolves.toEqual(action === "disconnect" ? undefined : replacement)
      expect(fetch).toHaveBeenCalledOnce()
    },
  )
})
