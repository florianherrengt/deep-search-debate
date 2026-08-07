import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import kdbxweb from "kdbxweb"
import {
  loadKeePassSecrets,
  resolveKeePassFilePath,
} from "./keepassSecrets.ts"

interface TestEntry {
  customValue?: string
  group?: string
  notes?: string
  password?: string
  passwordProtected?: boolean
  removePassword?: boolean
  tags?: string[]
  title?: string
  url?: string
  username?: string
}

const temporaryDirectories: string[] = []

async function createTestDatabase(
  password: string,
  entries: TestEntry[],
  version: 3 | 4 = 4,
  kdf: string = kdbxweb.Consts.KdfId.Aes,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deep-search-keepass-"))
  temporaryDirectories.push(directory)
  const filePath = join(directory, "secrets.kdbx")
  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
  )
  const database = kdbxweb.Kdbx.create(credentials, "Test secrets")
  database.setVersion(version)
  database.setKdf(kdf)
  const root = database.getDefaultGroup()
  const groups = new Map<string, kdbxweb.KdbxGroup>([["", root]])

  for (const input of entries) {
    const groupName = input.group ?? ""
    let group = groups.get(groupName)
    if (group === undefined) {
      group = database.createGroup(root, groupName)
      groups.set(groupName, group)
    }

    const entry = database.createEntry(group)
    if (input.title !== undefined) entry.fields.set("Title", input.title)
    if (input.removePassword) entry.fields.delete("Password")
    else if (input.password !== undefined) {
      entry.fields.set(
        "Password",
        input.passwordProtected === false
          ? input.password
          : kdbxweb.ProtectedValue.fromString(input.password),
      )
    }
    if (input.username !== undefined) {
      entry.fields.set("UserName", input.username)
    }
    if (input.url !== undefined) entry.fields.set("URL", input.url)
    if (input.notes !== undefined) entry.fields.set("Notes", input.notes)
    if (input.customValue !== undefined) {
      entry.fields.set("CustomSecret", input.customValue)
    }
    if (input.tags !== undefined) entry.tags = input.tags
  }

  await writeFile(filePath, new Uint8Array(await database.save()), {
    mode: 0o600,
  })
  return filePath
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe("resolveKeePassFilePath", () => {
  it("selects a database from the runtime environment", () => {
    expect(resolveKeePassFilePath("development")).toMatch(
      /\/secrets\/dev\.kdbx$/,
    )
    expect(resolveKeePassFilePath("test")).toMatch(/\/secrets\/test\.kdbx$/)
    expect(resolveKeePassFilePath("production")).toMatch(
      /\/secrets\/prod\.kdbx$/,
    )
  })
})

describe("loadKeePassSecrets", () => {
  it("loads multiple exact titles recursively and only reads Password", async () => {
    const filePath = await createTestDatabase("test-master-password", [
      {
        group: "nested",
        title: "DEEPSEEK_API_KEY",
        password: "deepseek-secret",
        username: "wrong-username-value",
      },
      {
        group: "other",
        title: "DATABASE_URL",
        password: "  sqlite://preserve-whitespace  ",
        passwordProtected: false,
      },
      {
        title: "deepseek_api_key",
        password: "wrong-case-value",
      },
    ])

    const secrets = await loadKeePassSecrets({
      filePath,
      password: "test-master-password",
      requiredTitles: ["DEEPSEEK_API_KEY", "DATABASE_URL"] as const,
    })

    expect(secrets).toEqual({
      DEEPSEEK_API_KEY: "deepseek-secret",
      DATABASE_URL: "  sqlite://preserve-whitespace  ",
    })
    expect(Object.isFrozen(secrets)).toBe(true)
  })

  it("loads KDBX3 databases", async () => {
    const filePath = await createTestDatabase(
      "test-master-password",
      [{ title: "DEEPSEEK_API_KEY", password: "deepseek-secret" }],
      3,
    )

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: ["DEEPSEEK_API_KEY"] as const,
      }),
    ).resolves.toEqual({ DEEPSEEK_API_KEY: "deepseek-secret" })
  })

  it.each([
    ["Argon2d", kdbxweb.Consts.KdfId.Argon2d],
    ["Argon2id", kdbxweb.Consts.KdfId.Argon2id],
  ])("loads KDBX4 databases using %s", async (_name, kdf) => {
    const filePath = await createTestDatabase(
      "test-master-password",
      [{ title: "DEEPSEEK_API_KEY", password: "deepseek-secret" }],
      4,
      kdf,
    )

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: ["DEEPSEEK_API_KEY"] as const,
      }),
    ).resolves.toEqual({ DEEPSEEK_API_KEY: "deepseek-secret" })
  })

  it("rejects a missing exact-case title", async () => {
    const filePath = await createTestDatabase("test-master-password", [
      { title: "deepseek_api_key", password: "wrong-case-value" },
    ])

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: ["DEEPSEEK_API_KEY"] as const,
      }),
    ).rejects.toThrow("Required KeePass entry is missing: DEEPSEEK_API_KEY")
  })

  it("rejects duplicate titles across groups", async () => {
    const filePath = await createTestDatabase("test-master-password", [
      { group: "one", title: "DEEPSEEK_API_KEY", password: "first" },
      { group: "two", title: "DEEPSEEK_API_KEY", password: "second" },
    ])

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: ["DEEPSEEK_API_KEY"] as const,
      }),
    ).rejects.toThrow("Required KeePass entry is duplicated: DEEPSEEK_API_KEY")
  })

  it.each([
    [
      "an absent Password despite populated ignored fields",
      {
        removePassword: true,
        username: "must-not-be-used",
        url: "https://must-not-be-used.example",
        notes: "must-not-be-used",
        customValue: "must-not-be-used",
        tags: ["must-not-be-used"],
      },
    ],
    ["an empty Password", { password: "" }],
    ["a whitespace-only Password", { password: "   " }],
  ])("rejects %s", async (_label, passwordFields) => {
    const filePath = await createTestDatabase("test-master-password", [
      { title: "DEEPSEEK_API_KEY", ...passwordFields },
    ])

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: ["DEEPSEEK_API_KEY"] as const,
      }),
    ).rejects.toThrow(
      "Required KeePass entry has an empty Password: DEEPSEEK_API_KEY",
    )
  })

  it.each([undefined, "", "   "])(
    "rejects a missing or blank bootstrap password",
    async (password) => {
      await expect(
        loadKeePassSecrets({
          filePath: "/does/not/matter.kdbx",
          password,
          requiredTitles: [] as const,
        }),
      ).rejects.toThrow("KDBX_PASSWORD is required")
    },
  )

  it("rejects a nonexistent database", async () => {
    await expect(
      loadKeePassSecrets({
        filePath: "/does/not/exist.kdbx",
        password: "test-master-password",
        requiredTitles: [] as const,
      }),
    ).rejects.toThrow("Unable to read KeePass database")
  })

  it.runIf(process.getuid?.() !== 0)("rejects an unreadable database", async () => {
    const filePath = await createTestDatabase("test-master-password", [])
    await chmod(filePath, 0o000)

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: [] as const,
      }),
    ).rejects.toThrow("Unable to read KeePass database")
  })

  it("sanitizes incorrect-password errors", async () => {
    const masterPassword = "master-password-must-not-leak"
    const filePath = await createTestDatabase(masterPassword, [])

    let error: unknown
    try {
      await loadKeePassSecrets({
        filePath,
        password: "incorrect-password-must-not-leak",
        requiredTitles: [] as const,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("invalid password")
    expect(String(error)).not.toContain(masterPassword)
    expect(String(error)).not.toContain("incorrect-password-must-not-leak")
  })

  it("sanitizes corrupted-database errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deep-search-keepass-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "corrupt.kdbx")
    const fileContents = "corrupt-database-secret-must-not-leak"
    await writeFile(filePath, fileContents)

    await expect(
      loadKeePassSecrets({
        filePath,
        password: "test-master-password",
        requiredTitles: [] as const,
      }),
    ).rejects.not.toThrow(fileContents)
  })
})
