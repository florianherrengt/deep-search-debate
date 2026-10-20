import { describe, expect, it } from "vitest"
import { validatePublicIpAddress, validateUrl } from "./urlValidation.ts"

describe("validateUrl", () => {
  it("normalizes a public HTTPS hostname with a trailing DNS root dot", () => {
    expect(validateUrl(" https://Example.com./research?q=1 ").href).toBe(
      "https://example.com/research?q=1",
    )
  })

  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "https://localhost./private",
    "https://research.local/private",
    "https://10.0.0.1/private",
    "https://[::ffff:192.168.1.4]/private",
    "https://[fe80::1]/private",
  ])("rejects unsafe destination %s", (url) => {
    expect(() => validateUrl(url)).toThrow()
  })

  it("accepts public IPv4 and IPv6 literals", () => {
    expect(validateUrl("https://93.184.216.34/").hostname).toBe("93.184.216.34")
    expect(validateUrl("https://[2001:4860:4860::8888]/").hostname).toBe(
      "[2001:4860:4860::8888]",
    )
  })
})

describe("validatePublicIpAddress", () => {
  it.each(["127.0.0.1", "169.254.1.1", "192.168.1.2", "::1", "fc00::1"])(
    "rejects non-public DNS answer %s",
    (address) => {
      expect(() => validatePublicIpAddress(address)).toThrow()
    },
  )

  it("accepts public DNS answers", () => {
    expect(() => validatePublicIpAddress("93.184.216.34")).not.toThrow()
    expect(() => validatePublicIpAddress("2606:4700:4700::1111")).not.toThrow()
  })
})
