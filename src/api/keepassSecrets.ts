import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { argon2dAsync, argon2idAsync } from "@noble/hashes/argon2.js"
import kdbxweb, {
  type KdbxEntry,
  type KdbxEntryField,
} from "kdbxweb"

const { Credentials, CryptoEngine, Kdbx, KdbxError, ProtectedValue } = kdbxweb

export type RuntimeEnvironment = "development" | "test" | "production"

export type KeePassSecrets<Titles extends readonly string[]> = Readonly<{
  [Title in Titles[number]]: string
}>

export interface LoadKeePassSecretsOptions<
  Titles extends readonly string[],
> {
  filePath: string
  password: string | undefined
  requiredTitles: Titles
}

CryptoEngine.setArgon2Impl(
  async (
    password,
    salt,
    memory,
    iterations,
    length,
    parallelism,
    type,
    version,
  ) => {
    const derive =
      type === CryptoEngine.Argon2TypeArgon2id
        ? argon2idAsync
        : argon2dAsync
    const derived = await derive(
      new Uint8Array(password),
      new Uint8Array(salt),
      {
        t: iterations,
        m: memory,
        p: parallelism,
        dkLen: length,
        version,
      },
    )

    return Uint8Array.from(derived).buffer
  },
)

export function resolveKeePassFilePath(
  environment: RuntimeEnvironment,
): string {
  const fileName =
    environment === "production"
      ? "prod.kdbx"
      : environment === "development"
        ? "dev.kdbx"
        : "test.kdbx"

  return fileURLToPath(new URL(`./secrets/${fileName}`, import.meta.url))
}

function fieldText(field: KdbxEntryField | undefined): string | undefined {
  if (field === undefined) return undefined
  return field instanceof ProtectedValue ? field.getText() : field
}

function sanitizedDatabaseError(error: unknown): Error {
  if (!(error instanceof KdbxError)) {
    return new Error("Failed to decrypt the KeePass database")
  }

  switch (error.code) {
    case kdbxweb.Consts.ErrorCodes.InvalidKey:
      return new Error("Failed to decrypt the KeePass database: invalid password")
    case kdbxweb.Consts.ErrorCodes.BadSignature:
    case kdbxweb.Consts.ErrorCodes.FileCorrupt:
      return new Error("Failed to decrypt the KeePass database: corrupt file")
    case kdbxweb.Consts.ErrorCodes.InvalidVersion:
    case kdbxweb.Consts.ErrorCodes.Unsupported:
    case kdbxweb.Consts.ErrorCodes.NotImplemented:
      return new Error("Failed to decrypt the KeePass database: unsupported format")
    default:
      return new Error("Failed to decrypt the KeePass database")
  }
}

export async function loadKeePassSecrets<
  const Titles extends readonly string[],
>({
  filePath,
  password,
  requiredTitles,
}: LoadKeePassSecretsOptions<Titles>): Promise<KeePassSecrets<Titles>> {
  if (password === undefined || password.trim().length === 0) {
    throw new Error("KDBX_PASSWORD is required")
  }

  const uniqueTitles = new Set(requiredTitles)
  if (uniqueTitles.size !== requiredTitles.length) {
    throw new Error("requiredTitles must not contain duplicates")
  }

  let file: Buffer
  try {
    file = await readFile(filePath)
  } catch {
    throw new Error(`Unable to read KeePass database: ${filePath}`)
  }

  let database
  try {
    const credentials = new Credentials(ProtectedValue.fromString(password))
    database = await Kdbx.load(Uint8Array.from(file).buffer, credentials)
  } catch (error) {
    throw sanitizedDatabaseError(error)
  }

  const matches = new Map<string, KdbxEntry[]>()
  for (const title of uniqueTitles) matches.set(title, [])

  for (const rootGroup of database.groups) {
    for (const entry of rootGroup.allEntries()) {
      const title = fieldText(entry.fields.get("Title"))
      if (title === undefined || !uniqueTitles.has(title)) continue
      matches.get(title)?.push(entry)
    }
  }

  const secrets = Object.create(null) as Record<string, string>
  for (const title of requiredTitles) {
    const entries = matches.get(title) ?? []
    if (entries.length === 0) {
      throw new Error(`Required KeePass entry is missing: ${title}`)
    }
    if (entries.length > 1) {
      throw new Error(`Required KeePass entry is duplicated: ${title}`)
    }

    const value = fieldText(entries[0]?.fields.get("Password"))
    if (value === undefined || value.trim().length === 0) {
      throw new Error(`Required KeePass entry has an empty Password: ${title}`)
    }

    secrets[title] = value
  }

  return Object.freeze(secrets) as KeePassSecrets<Titles>
}
