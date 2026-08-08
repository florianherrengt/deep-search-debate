import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import kdbxweb from "kdbxweb"
import { resolveKeePassFilePath } from "./keepassSecrets.ts"

const TEST_KEEPASS_PASSWORD = "test-keepass-master-password"

export default async function setup() {
  const filePath = resolveKeePassFilePath("test")
  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(TEST_KEEPASS_PASSWORD),
  )
  const database = kdbxweb.Kdbx.create(credentials, "Test secrets")
  database.setKdf(kdbxweb.Consts.KdfId.Aes)
  const root = database.getDefaultGroup()
  const secrets = {
    BRAVE_SEARCH_API_KEY: "keepass-brave-key",
    DEEPSEEK_API_KEY: "keepass-deepseek-key",
    SCRAPINGANT_API_KEY: "keepass-scrapingant-key",
    BETTER_AUTH_SECRET: "keepass-auth-secret-with-at-least-32-characters",
    GITHUB_CLIENT_ID: "keepass-github-client-id",
    GITHUB_CLIENT_SECRET: "keepass-github-client-secret",
    AUTH_DEBUG_USER_PASSWORD: "keepass-debug-password",
  }
  for (const [title, password] of Object.entries(secrets)) {
    const entry = database.createEntry(root)
    entry.fields.set("Title", title)
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(password))
  }

  await mkdir(dirname(filePath), { recursive: true })
  await rm(filePath, { force: true })
  await writeFile(filePath, new Uint8Array(await database.save()), {
    flag: "wx",
    mode: 0o600,
  })

  return async () => {
    await rm(filePath, { force: true })
  }
}
