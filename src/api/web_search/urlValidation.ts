import ipaddr from "ipaddr.js"

const blockedSchemes = [
  "file:",
  "data:",
  "javascript:",
  "vbscript:",
  "tauri:",
  "about:",
  "blob:",
] as const

const privateHostnames = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
])

class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UrlValidationError"
  }
}

function parseIpAddress(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const bare = hostname.replace(/^\[|\]$/g, "")

  try {
    const address = ipaddr.parse(bare)

    return address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()
      ? (address as ipaddr.IPv6).toIPv4Address()
      : address
  } catch {
    return null
  }
}

function isPrivateIp(hostname: string): boolean {
  const address = parseIpAddress(hostname)
  return address ? address.range() !== "unicast" : false
}

export function validatePublicIpAddress(address: string): void {
  const parsedAddress = parseIpAddress(address)

  if (!parsedAddress || parsedAddress.range() !== "unicast") {
    throw new UrlValidationError(
      `Private/special-use IP address not allowed: ${address}`,
    )
  }
}

export function validateUrl(raw: string): URL {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  const blockedScheme = blockedSchemes.find((scheme) => lower.startsWith(scheme))

  if (blockedScheme) {
    throw new UrlValidationError(`Blocked scheme: ${blockedScheme}`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new UrlValidationError(`Invalid URL: ${trimmed}`)
  }

  if (parsed.protocol !== "https:") {
    throw new UrlValidationError(
      `Only https URLs are allowed, got: ${parsed.protocol}`,
    )
  }

  if (parsed.username || parsed.password) {
    throw new UrlValidationError("URL credentials are not allowed")
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "")

  if (!hostname) {
    throw new UrlValidationError("URL must include a public hostname.")
  }
  if (hostname !== parsed.hostname) parsed.hostname = hostname

  if (privateHostnames.has(hostname)) {
    throw new UrlValidationError(
      `Private/loopback hostname not allowed: ${hostname}`,
    )
  }
  if (hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new UrlValidationError(`Local hostname not allowed: ${hostname}`)
  }
  if (isPrivateIp(hostname)) {
    throw new UrlValidationError(
      `Private/special-use IP address not allowed: ${hostname}`,
    )
  }

  return parsed
}
