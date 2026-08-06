import { rm } from "node:fs/promises"

export default async function globalTeardown(): Promise<void> {
  const database = process.env.PLAYWRIGHT_E2E_DATABASE_URL
  if (!database) return

  await Promise.all(
    [database, `${database}-shm`, `${database}-wal`].map((path) =>
      rm(path, { force: true }),
    ),
  )
}
