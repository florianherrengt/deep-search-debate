import { describe, expect, it } from "vitest"

import {
  decryptDeepSeekApiKey,
  encryptDeepSeekApiKey,
  decryptOpenAiCodexCredentials,
  encryptOpenAiCodexCredentials,
  OpenAiCodexCredentialDecryptionError,
} from "./credentialCipher.ts"

const key = Buffer.alloc(32, 7)
const identity = {
  userId: "user-a",
  connectionId: "connection-a",
}
const credentials = Buffer.from('{"tokens":{"access":"secret"}}', "utf8")
const deepSeekIdentity = { userId: "user-a" }
const deepSeekApiKey = Buffer.from("sk-private-deepseek-key")

describe("OpenAI Codex credential encryption", () => {
  it("round-trips credentials with a fresh standard AES-GCM nonce", () => {
    const first = encryptOpenAiCodexCredentials(credentials, key, identity)
    const second = encryptOpenAiCodexCredentials(credentials, key, identity)

    expect(first.nonce).toHaveLength(12)
    expect(first.authenticationTag).toHaveLength(16)
    expect(first.nonce.equals(second.nonce)).toBe(false)
    expect(
      decryptOpenAiCodexCredentials(first, key, identity),
    ).toEqual(credentials)
  })

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptOpenAiCodexCredentials(credentials, key, identity)
    const ciphertext = Buffer.from(encrypted.ciphertext)
    ciphertext[0] = ciphertext[0] ^ 1

    expect(() =>
      decryptOpenAiCodexCredentials(
        { ...encrypted, ciphertext },
        key,
        identity,
      ),
    ).toThrow(OpenAiCodexCredentialDecryptionError)
  })

  it("rejects credentials copied to a different user or connection identity", () => {
    const encrypted = encryptOpenAiCodexCredentials(credentials, key, identity)

    for (const wrongIdentity of [
      { ...identity, userId: "user-b" },
      { ...identity, connectionId: "connection-b" },
    ]) {
      expect(() =>
        decryptOpenAiCodexCredentials(encrypted, key, wrongIdentity),
      ).toThrow(OpenAiCodexCredentialDecryptionError)
    }
  })
})

describe("DeepSeek API key encryption", () => {
  it("round-trips keys and binds ciphertext to the owning user", () => {
    const encrypted = encryptDeepSeekApiKey(deepSeekApiKey, key, deepSeekIdentity)

    expect(encrypted.nonce).toHaveLength(12)
    expect(encrypted.authenticationTag).toHaveLength(16)
    expect(decryptDeepSeekApiKey(encrypted, key, deepSeekIdentity)).toEqual(
      deepSeekApiKey,
    )
    expect(() =>
      decryptDeepSeekApiKey(encrypted, key, { userId: "user-b" }),
    ).toThrow("Stored DeepSeek API key could not be decrypted")
  })

  it("uses an AAD domain that cannot decrypt as OpenAI credentials", () => {
    const encrypted = encryptDeepSeekApiKey(deepSeekApiKey, key, {
      userId: identity.userId,
    })

    expect(() =>
      decryptOpenAiCodexCredentials(encrypted, key, identity),
    ).toThrow(OpenAiCodexCredentialDecryptionError)
  })
})
