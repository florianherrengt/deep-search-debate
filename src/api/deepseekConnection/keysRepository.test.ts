import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import { deepSeekApiKeys } from "../db/schema/index.ts"
import { testUserId } from "../db/testSetup.ts"
import {
  deleteDeepSeekApiKey,
  getDeepSeekApiKey,
  hasDeepSeekApiKey,
  setDeepSeekApiKey,
} from "./keysRepository.ts"

afterEach(() => {
  db.delete(deepSeekApiKeys).run()
})

describe("DeepSeek API key repository", () => {
  it("stores the user's key encrypted and can replace and delete it", () => {
    const apiKey = "sk-deepseek-private-key"

    expect(getDeepSeekApiKey(testUserId)).toBeUndefined()
    expect(hasDeepSeekApiKey(testUserId)).toBe(false)

    setDeepSeekApiKey(testUserId, apiKey)
    const stored = db.select().from(deepSeekApiKeys).get()!
    expect(stored.apiKeyCiphertext.equals(Buffer.from(apiKey))).toBe(false)
    expect(stored.apiKeyNonce).toHaveLength(12)
    expect(stored.apiKeyAuthenticationTag).toHaveLength(16)
    expect(getDeepSeekApiKey(testUserId)).toBe(apiKey)
    expect(hasDeepSeekApiKey(testUserId)).toBe(true)
    expect(db.$client.serialize().includes(Buffer.from(apiKey))).toBe(false)

    setDeepSeekApiKey(testUserId, "sk-replacement")
    expect(getDeepSeekApiKey(testUserId)).toBe("sk-replacement")
    expect(deleteDeepSeekApiKey(testUserId)).toBe(true)
    expect(deleteDeepSeekApiKey(testUserId)).toBe(false)
    expect(getDeepSeekApiKey(testUserId)).toBeUndefined()
  })

  it("detects corruption when reading and can still delete without decrypting", () => {
    setDeepSeekApiKey(testUserId, "sk-corrupt-me")
    db.update(deepSeekApiKeys)
      .set({ apiKeyCiphertext: Buffer.alloc(22, 9) })
      .where(eq(deepSeekApiKeys.userId, testUserId))
      .run()

    expect(() => getDeepSeekApiKey(testUserId)).toThrow(
      "Stored DeepSeek API key could not be decrypted",
    )
    expect(deleteDeepSeekApiKey(testUserId)).toBe(true)
  })
})
