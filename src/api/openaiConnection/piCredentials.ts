import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai"
import z from "zod"

import { secureJsonParse } from "../helpers/secureJsonParse.ts"
import { OpenAiCodexError } from "./codexErrors.ts"
import {
  compareAndSwapOpenAiCodexCredentials,
  deleteOpenAiCodexConnectionForUser,
  getOpenAiCodexConnection,
  hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection,
  type OpenAiCodexConnectionSnapshot,
} from "./credentialsRepository.ts"

export const PI_CODEX_PROVIDER_ID = "openai-codex"

const credentialTails = new Map<string, Promise<void>>()

const oauthCredentialSchema = z.looseObject({
  type: z.literal("oauth"),
  access: z.string().min(1).max(100_000),
  refresh: z.string().min(1).max(100_000),
  expires: z.number().int().positive(),
  accountId: z.string().min(1).max(1_000),
})

const legacyCredentialSchema = z.object({
  type: z.undefined().optional(),
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({
    access_token: oauthCredentialSchema.shape.access,
    refresh_token: oauthCredentialSchema.shape.refresh,
    account_id: oauthCredentialSchema.shape.accountId,
  }),
})

const tokenExpirySchema = z.object({ exp: z.number().int().positive() })

export function encodePiCodexCredential(
  credential: OAuthCredential,
): Buffer {
  return Buffer.from(
    JSON.stringify(oauthCredentialSchema.parse(credential)),
    "utf8",
  )
}

function decodePiCodexCredential(
  connection: OpenAiCodexConnectionSnapshot,
): OAuthCredential {
  try {
    const stored = secureJsonParse(connection.credentials.toString("utf8"))
    const current = oauthCredentialSchema.safeParse(stored)
    if (current.success) return current.data

    // Pre-Pi connections contain Codex's auth.json. Adapt on read; the existing
    // refresh path persists the next rotated credential in Pi's format.
    const { tokens } = legacyCredentialSchema.parse(stored)
    const parts = tokens.access_token.split(".")
    const payload = parts[1]
    if (parts.length !== 3 || !payload || !/^[A-Za-z0-9_-]+$/.test(payload)) {
      throw new OpenAiCodexError("protocol-incompatible")
    }
    // The claim only schedules refresh. OpenAI still authenticates the token.
    const { exp } = tokenExpirySchema.parse(secureJsonParse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ))
    return oauthCredentialSchema.parse({
      type: "oauth",
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: exp * 1_000,
      accountId: tokens.account_id,
    })
  } catch {
    throw new OpenAiCodexError("protocol-incompatible")
  } finally {
    connection.credentials.fill(0)
  }
}

function readCredential(userId: string): OAuthCredential | undefined {
  const connection = getOpenAiCodexConnection(userId)
  return connection ? decodePiCodexCredential(connection) : undefined
}

function assertSupportedProvider(providerId: string): void {
  if (providerId !== PI_CODEX_PROVIDER_ID) {
    throw new Error(`Unsupported Pi credential provider: ${providerId}`)
  }
}

/** Serializes refresh, login, and disconnect writes for one user. */
export async function withPiCodexCredentialLock<Result>(
  userId: string,
  operation: () => Promise<Result> | Result,
): Promise<Result> {
  const previous = credentialTails.get(userId) ?? Promise.resolve()
  const held = Promise.withResolvers<void>()
  const tail = previous.then(() => held.promise)
  credentialTails.set(userId, tail)
  await previous
  try {
    return await operation()
  } finally {
    held.resolve()
    if (credentialTails.get(userId) === tail) credentialTails.delete(userId)
  }
}

/** Binds Pi's OAuth refresh lifecycle to the existing encrypted user row. */
export class PiCodexCredentialStore implements CredentialStore {
  private readonly userId: string

  constructor(userId: string) {
    this.userId = userId
  }

  read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    assertSupportedProvider(providerId)
    return Promise.resolve(readCredential(this.userId))
  }

  list(
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted()
    return Promise.resolve(hasOpenAiCodexConnection(this.userId)
      ? [{ providerId: PI_CODEX_PROVIDER_ID, type: "oauth" }]
      : [])
  }

  async modify(
    providerId: string,
    update: (
      current: Credential | undefined,
    ) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    assertSupportedProvider(providerId)

    return withPiCodexCredentialLock(this.userId, async () => {
      options?.signal?.throwIfAborted()
      const connection = getOpenAiCodexConnection(this.userId)
      const current = connection
        ? decodePiCodexCredential(connection)
        : undefined
      const next = await update(current)
      options?.signal?.throwIfAborted()
      if (next === undefined) return current
      if (next.type !== "oauth") {
        throw new Error("OpenAI Codex requires an OAuth credential")
      }

      const encoded = encodePiCodexCredential(next)
      try {
        if (!connection) {
          replaceOpenAiCodexConnection(this.userId, encoded)
          return next
        }
        if (compareAndSwapOpenAiCodexCredentials(connection, encoded)) {
          return next
        }
        return readCredential(this.userId)
      } finally {
        encoded.fill(0)
      }
    })
  }

  async delete(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted()
    assertSupportedProvider(providerId)
    await withPiCodexCredentialLock(this.userId, () => {
      options?.signal?.throwIfAborted()
      deleteOpenAiCodexConnectionForUser(this.userId)
    })
  }
}
