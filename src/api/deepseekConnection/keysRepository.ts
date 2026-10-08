import { eq } from "drizzle-orm"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import { deepSeekApiKeys } from "../db/schema/index.ts"
import {
  decryptDeepSeekApiKey,
  encryptDeepSeekApiKey,
} from "../openaiConnection/credentialCipher.ts"

export function getDeepSeekApiKey(userId: string): string | undefined {
  const row = db
    .select()
    .from(deepSeekApiKeys)
    .where(eq(deepSeekApiKeys.userId, userId))
    .get()
  if (row === undefined) return undefined

  return decryptDeepSeekApiKey(
    {
      ciphertext: row.apiKeyCiphertext,
      nonce: row.apiKeyNonce,
      authenticationTag: row.apiKeyAuthenticationTag,
    },
    config.openAiCodex.credentialKey,
    { userId },
  ).toString("utf8")
}

export function hasDeepSeekApiKey(userId: string): boolean {
  return db
    .select({ userId: deepSeekApiKeys.userId })
    .from(deepSeekApiKeys)
    .where(eq(deepSeekApiKeys.userId, userId))
    .get() !== undefined
}

export function setDeepSeekApiKey(userId: string, apiKey: string): void {
  const encrypted = encryptDeepSeekApiKey(
    Buffer.from(apiKey, "utf8"),
    config.openAiCodex.credentialKey,
    { userId },
  )
  db.insert(deepSeekApiKeys)
    .values({
      userId,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyNonce: encrypted.nonce,
      apiKeyAuthenticationTag: encrypted.authenticationTag,
    })
    .onConflictDoUpdate({
      target: deepSeekApiKeys.userId,
      set: {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyNonce: encrypted.nonce,
        apiKeyAuthenticationTag: encrypted.authenticationTag,
      },
    })
    .run()
}

export function deleteDeepSeekApiKey(userId: string): boolean {
  return db
    .delete(deepSeekApiKeys)
    .where(eq(deepSeekApiKeys.userId, userId))
    .run().changes === 1
}
