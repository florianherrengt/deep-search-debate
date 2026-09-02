import { sql } from "drizzle-orm"
import {
  blob,
  check,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"

import { user } from "./auth.ts"

export const openAiCodexConnections = sqliteTable(
  "openai_codex_connections",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    credentialsCiphertext: blob("credentials_ciphertext", {
      mode: "buffer",
    }).notNull(),
    credentialsNonce: blob("credentials_nonce", { mode: "buffer" }).notNull(),
    credentialsAuthenticationTag: blob("credentials_authentication_tag", {
      mode: "buffer",
    }).notNull(),
  },
  (table) => [
    check(
      "openai_codex_connections_connection_id_check",
      sql`length(trim(${table.connectionId})) > 0`,
    ),
    check(
      "openai_codex_connections_ciphertext_check",
      sql`typeof(${table.credentialsCiphertext}) = 'blob' and length(${table.credentialsCiphertext}) > 0`,
    ),
    check(
      "openai_codex_connections_nonce_check",
      sql`typeof(${table.credentialsNonce}) = 'blob' and length(${table.credentialsNonce}) = 12`,
    ),
    check(
      "openai_codex_connections_authentication_tag_check",
      sql`typeof(${table.credentialsAuthenticationTag}) = 'blob' and length(${table.credentialsAuthenticationTag}) = 16`,
    ),
  ],
)
