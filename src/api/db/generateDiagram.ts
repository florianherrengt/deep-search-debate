import { sqliteGenerate } from "drizzle-dbml-generator"
import * as schema from "./schema/index.ts"

sqliteGenerate({
  schema,
  out: "./db/schema.dbml",
})
