import { sql } from "drizzle-orm"
import { blob, check, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { user } from "./auth.ts"

export const deepSeekApiKeys = sqliteTable(
  "deepseek_api_keys",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    apiKeyCiphertext: blob("api_key_ciphertext", { mode: "buffer" }).notNull(),
    apiKeyNonce: blob("api_key_nonce", { mode: "buffer" }).notNull(),
    apiKeyAuthenticationTag: blob("api_key_authentication_tag", {
      mode: "buffer",
    }).notNull(),
  },
  (table) => [
    check(
      "deepseek_api_keys_ciphertext_check",
      sql`typeof(${table.apiKeyCiphertext}) = 'blob' and length(${table.apiKeyCiphertext}) > 0`,
    ),
    check(
      "deepseek_api_keys_nonce_check",
      sql`typeof(${table.apiKeyNonce}) = 'blob' and length(${table.apiKeyNonce}) = 12`,
    ),
    check(
      "deepseek_api_keys_authentication_tag_check",
      sql`typeof(${table.apiKeyAuthenticationTag}) = 'blob' and length(${table.apiKeyAuthenticationTag}) = 16`,
    ),
  ],
)
