import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export default async function globalTeardown(): Promise<void> {
  const database = process.env.PLAYWRIGHT_E2E_DATABASE_URL
  const keepass = fileURLToPath(
    new URL("../../api/secrets/test.kdbx", import.meta.url),
  )
  const paths = database
    ? [database, `${database}-shm`, `${database}-wal`, keepass]
    : [keepass]

  await Promise.all(paths.map((path) => rm(path, { force: true })))
}
