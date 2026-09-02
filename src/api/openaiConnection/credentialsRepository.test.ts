import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import { openAiCodexConnections } from "../db/schema/index.ts"
import { testUserId } from "../db/testSetup.ts"
import {
  compareAndSwapOpenAiCodexCredentials,
  deleteOpenAiCodexConnectionForUser,
  getOpenAiCodexConnection,
  hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection,
} from "./credentialsRepository.ts"

afterEach(() => {
  db.delete(openAiCodexConnections).run()
})

describe("OpenAI Codex credential repository", () => {
  it("replaces and decrypts a user's connection without storing plaintext", () => {
    const credentials = Buffer.from(
      '{"tokens":{"access":"unique-plaintext-credential"}}',
      "utf8",
    )

    replaceOpenAiCodexConnection(testUserId, credentials)
    const stored = db.select().from(openAiCodexConnections).get()!
    const created = getOpenAiCodexConnection(testUserId)!

    expect(created).toMatchObject({ userId: testUserId })
    expect(created.connectionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(stored.credentialsCiphertext.equals(credentials)).toBe(false)
    expect(stored.credentialsNonce).toHaveLength(12)
    expect(stored.credentialsAuthenticationTag).toHaveLength(16)
    expect(db.$client.serialize().includes(credentials)).toBe(false)
    expect(hasOpenAiCodexConnection(testUserId)).toBe(true)
    expect(getOpenAiCodexConnection(testUserId)).toEqual(created)
  })

  it("refreshes rotated credentials for the current connection", () => {
    replaceOpenAiCodexConnection(
      testUserId,
      Buffer.from("initial-credentials"),
    )
    const initial = getOpenAiCodexConnection(testUserId)!
    const rotatedCredentials = Buffer.from("rotated-credentials")

    const rotated = compareAndSwapOpenAiCodexCredentials(
      initial,
      rotatedCredentials,
    )

    expect(rotated).toBe(true)
    expect(getOpenAiCodexConnection(testUserId)).toEqual({
      ...initial,
      credentials: rotatedCredentials,
    })
  })

  it("does not refresh a replaced or disconnected connection", () => {
    replaceOpenAiCodexConnection(
      testUserId,
      Buffer.from("initial-credentials"),
    )
    const replacedSnapshot = getOpenAiCodexConnection(testUserId)!

    replaceOpenAiCodexConnection(
      testUserId,
      Buffer.from("replacement-credentials"),
    )
    const current = getOpenAiCodexConnection(testUserId)!

    expect(
      compareAndSwapOpenAiCodexCredentials(
        replacedSnapshot,
        Buffer.from("stale-credentials"),
      ),
    ).toBe(false)
    expect(getOpenAiCodexConnection(testUserId)).toEqual(current)

    expect(deleteOpenAiCodexConnectionForUser(testUserId)).toBe(true)
    expect(
      compareAndSwapOpenAiCodexCredentials(
        current,
        Buffer.from("disconnected-credentials"),
      ),
    ).toBe(false)
    expect(getOpenAiCodexConnection(testUserId)).toBeUndefined()
  })

  it("explicitly disconnects without decrypting corrupted credentials", () => {
    replaceOpenAiCodexConnection(
      testUserId,
      Buffer.from("credentials-to-corrupt"),
    )
    db.update(openAiCodexConnections)
      .set({ credentialsCiphertext: Buffer.alloc(22, 9) })
      .where(eq(openAiCodexConnections.userId, testUserId))
      .run()

    expect(hasOpenAiCodexConnection(testUserId)).toBe(true)
    expect(() => getOpenAiCodexConnection(testUserId)).toThrow(
      "Stored OpenAI Codex credentials could not be decrypted",
    )
    expect(deleteOpenAiCodexConnectionForUser(testUserId)).toBe(true)
    expect(deleteOpenAiCodexConnectionForUser(testUserId)).toBe(false)
  })
})
