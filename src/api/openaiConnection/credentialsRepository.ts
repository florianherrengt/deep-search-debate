import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import { openAiCodexConnections } from "../db/schema/index.ts"
import {
  decryptOpenAiCodexCredentials,
  encryptOpenAiCodexCredentials,
} from "./credentialCipher.ts"

export type OpenAiCodexConnectionSnapshot = {
  userId: string
  connectionId: string
  credentials: Buffer
}

function decryptConnection(
  row: typeof openAiCodexConnections.$inferSelect,
): OpenAiCodexConnectionSnapshot {
  const identity = {
    userId: row.userId,
    connectionId: row.connectionId,
  }
  return {
    ...identity,
    credentials: decryptOpenAiCodexCredentials(
      {
        ciphertext: row.credentialsCiphertext,
        nonce: row.credentialsNonce,
        authenticationTag: row.credentialsAuthenticationTag,
      },
      config.openAiCodex.credentialKey,
      identity,
    ),
  }
}

export function getOpenAiCodexConnection(
  userId: string,
): OpenAiCodexConnectionSnapshot | undefined {
  const row = db
    .select()
    .from(openAiCodexConnections)
    .where(eq(openAiCodexConnections.userId, userId))
    .get()
  return row === undefined ? undefined : decryptConnection(row)
}

export function hasOpenAiCodexConnection(userId: string): boolean {
  return (
    db
      .select({ userId: openAiCodexConnections.userId })
      .from(openAiCodexConnections)
      .where(eq(openAiCodexConnections.userId, userId))
      .get() !== undefined
  )
}

export function replaceOpenAiCodexConnection(
  userId: string,
  credentials: Buffer,
): void {
  const connectionId = randomUUID()
  const identity = { userId, connectionId }
  const encrypted = encryptOpenAiCodexCredentials(
    credentials,
    config.openAiCodex.credentialKey,
    identity,
  )

  db.insert(openAiCodexConnections)
    .values({
      ...identity,
      credentialsCiphertext: encrypted.ciphertext,
      credentialsNonce: encrypted.nonce,
      credentialsAuthenticationTag: encrypted.authenticationTag,
    })
    .onConflictDoUpdate({
      target: openAiCodexConnections.userId,
      set: {
        connectionId,
        credentialsCiphertext: encrypted.ciphertext,
        credentialsNonce: encrypted.nonce,
        credentialsAuthenticationTag: encrypted.authenticationTag,
      },
    })
    .run()
}

export function compareAndSwapOpenAiCodexCredentials(
  snapshot: OpenAiCodexConnectionSnapshot,
  credentials: Buffer,
): boolean {
  const identity = {
    userId: snapshot.userId,
    connectionId: snapshot.connectionId,
  }
  const encrypted = encryptOpenAiCodexCredentials(
    credentials,
    config.openAiCodex.credentialKey,
    identity,
  )
  const result = db
    .update(openAiCodexConnections)
    .set({
      credentialsCiphertext: encrypted.ciphertext,
      credentialsNonce: encrypted.nonce,
      credentialsAuthenticationTag: encrypted.authenticationTag,
    })
    .where(
      and(
        eq(openAiCodexConnections.userId, snapshot.userId),
        eq(openAiCodexConnections.connectionId, snapshot.connectionId),
      ),
    )
    .run()

  return result.changes === 1
}

/** Explicit user disconnect; deliberately does not load or decrypt credentials. */
export function deleteOpenAiCodexConnectionForUser(userId: string): boolean {
  const result = db
    .delete(openAiCodexConnections)
    .where(eq(openAiCodexConnections.userId, userId))
    .run()
  return result.changes === 1
}
