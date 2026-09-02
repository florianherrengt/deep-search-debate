import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const CREDENTIAL_AAD_DOMAIN = "rethinkloop.openai-codex-credentials"

export type OpenAiCodexCredentialIdentity = {
  userId: string
  connectionId: string
}

export type EncryptedOpenAiCodexCredentials = {
  ciphertext: Buffer
  nonce: Buffer
  authenticationTag: Buffer
}

export class OpenAiCodexCredentialDecryptionError extends Error {
  override readonly name = "OpenAiCodexCredentialDecryptionError"

  constructor() {
    super("Stored OpenAI Codex credentials could not be decrypted")
  }
}

function credentialAdditionalAuthenticatedData(
  identity: OpenAiCodexCredentialIdentity,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      CREDENTIAL_AAD_DOMAIN,
      identity.userId,
      identity.connectionId,
    ]),
    "utf8",
  )
}

export function encryptOpenAiCodexCredentials(
  credentials: Buffer,
  key: Buffer,
  identity: OpenAiCodexCredentialIdentity,
): EncryptedOpenAiCodexCredentials {
  if (credentials.byteLength === 0) {
    throw new Error("OpenAI Codex credentials must not be empty")
  }
  if (key.byteLength !== 32) {
    throw new Error("OpenAI Codex credential key must contain exactly 32 bytes")
  }

  const nonce = randomBytes(AES_GCM_NONCE_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, nonce, {
    authTagLength: AES_GCM_TAG_BYTES,
  })
  cipher.setAAD(credentialAdditionalAuthenticatedData(identity))
  const ciphertext = Buffer.concat([
    cipher.update(credentials),
    cipher.final(),
  ])

  return {
    ciphertext,
    nonce,
    authenticationTag: cipher.getAuthTag(),
  }
}

export function decryptOpenAiCodexCredentials(
  encrypted: EncryptedOpenAiCodexCredentials,
  key: Buffer,
  identity: OpenAiCodexCredentialIdentity,
): Buffer {
  if (key.byteLength !== 32) {
    throw new Error("OpenAI Codex credential key must contain exactly 32 bytes")
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      encrypted.nonce,
      { authTagLength: AES_GCM_TAG_BYTES },
    )
    decipher.setAAD(credentialAdditionalAuthenticatedData(identity))
    decipher.setAuthTag(encrypted.authenticationTag)
    return Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ])
  } catch {
    throw new OpenAiCodexCredentialDecryptionError()
  }
}
