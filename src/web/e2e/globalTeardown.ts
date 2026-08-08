import { rm } from "node:fs/promises"

export default async function globalTeardown(): Promise<void> {
  const database = process.env.PLAYWRIGHT_E2E_DATABASE_URL
  const paths = database
    ? [database, `${database}-shm`, `${database}-wal`]
    : []

  await Promise.all(paths.map((path) => rm(path, { force: true })))
}
