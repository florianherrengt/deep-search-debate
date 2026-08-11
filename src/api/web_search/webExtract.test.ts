import { describe, expect, it, vi } from "vitest"
import type {
  ScrapingAntClient,
  ScrapingAntPage,
} from "./scrapingAnt.ts"
import {
  createWebExtractor,
  type PageRetrievalLog,
} from "./webExtract.ts"

function usableHtml(label = "Useful evidence"): string {
  return `<html><head><title>${label}</title></head><body><main><h1>${label}</h1><p>${`${label} explains the concrete facts required for this research question. `.repeat(8)}</p></main></body></html>`
}

function htmlPage(
  html: string,
  metadata: Omit<ScrapingAntPage, "body"> = {},
): ScrapingAntPage {
  return { body: new TextEncoder().encode(html), ...metadata }
}

function usablePdf(): Uint8Array {
  const lines = Array.from(
    { length: 8 },
    (_, index) =>
      `Useful PDF evidence line ${index + 1} for the research pipeline and its validation behavior.`,
  )
  const escapedLines = lines.map(
    (line) =>
      `(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj\nT*`,
  )
  const stream = [
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "50 750 Td",
    ...escapedLines,
    "ET",
  ].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

function createHarness() {
  const fetchPage = vi.fn<ScrapingAntClient["fetchPage"]>()
  const logs: PageRetrievalLog[] = []
  let clock = 0
  const extract = createWebExtractor({
    client: { fetchPage: (params) => fetchPage(params) },
    log: (entry) => logs.push(structuredClone(entry)),
    now: () => {
      clock += 10
      return clock
    },
  })
  return { extract, fetchPage, logs }
}

describe("webExtract", () => {
  it("uses the cheap ScrapingAnt request when it returns usable content", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml(), {
      credits: 1,
    }))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(harness.fetchPage).toHaveBeenCalledExactlyOnceWith({
      url: "https://example.com/page",
      mode: "http",
      signal: undefined,
    })
    expect(result.retrievalMethod).toBe("scrapingant-http")
    expect(result.content).toContain("Useful evidence explains")
    expect(harness.logs).toEqual([
      {
        event: "page-retrieval-attempt",
        url: "https://example.com/page",
        domain: "example.com",
        method: "scrapingant-http",
        outcome: "success",
        latencyMs: 10,
        credits: 1,
      },
    ])
  })

  it("extracts PDF text instead of accepting the binary payload as HTML", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce({
      body: usablePdf(),
      contentType: "application/pdf",
      credits: 1,
    })

    const result = await harness.extract({
      url: "https://example.com/report.pdf",
    })

    expect(result.content).toContain("# PDF document")
    expect(result.content).toContain("Useful PDF evidence line 8")
  })

  it("rejects non-document binary payloads before visible-text extraction", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockResolvedValueOnce({
        body: new Uint8Array(500).fill(0xff),
        contentType: "image/png",
        credits: 1,
      })
      .mockResolvedValueOnce(htmlPage(usableHtml("Browser document"), {
        contentType: "text/html; charset=utf-8",
        credits: 10,
      }))

    const result = await harness.extract({ url: "https://example.com/image" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser-us",
    ])
    expect(result.content).toContain("Browser document explains")
    expect(harness.logs[0]).toMatchObject({
      outcome: "failure",
      failure: "Unsupported page content type: image/png",
    })
  })

  it("logs a failed cheap request before escalating to browser rendering", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockRejectedValueOnce(new Error("provider transport failed"))
      .mockResolvedValueOnce(htmlPage(usableHtml("Rendered evidence"), {
        credits: 10,
      }))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser-us",
    ])
    expect(result.retrievalMethod).toBe("scrapingant-browser-us")
    expect(result.content).toContain("Rendered evidence explains")
    expect(harness.logs).toEqual([
      expect.objectContaining({
        method: "scrapingant-http",
        outcome: "failure",
        latencyMs: 10,
        failure: "provider transport failed",
      }),
      expect.objectContaining({
        method: "scrapingant-browser-us",
        outcome: "success",
        latencyMs: 10,
        credits: 10,
      }),
    ])
  })

  it.each([
    {
      name: "trivial content",
      page: htmlPage("<html><body>Too short</body></html>"),
    },
    {
      name: "an access challenge",
      page: htmlPage(
        `<html><head><title>Access denied</title></head><body>${"Verify you are human. ".repeat(30)}</body></html>`,
      ),
    },
    {
      name: "an obvious error page",
      page: htmlPage(
        `<html><head><title>Page not found</title></head><body>${"Navigation and missing-page filler. ".repeat(20)}</body></html>`,
      ),
    },
    {
      name: "a site-suffixed soft error page",
      page: htmlPage(
        `<html><head><title>404 | Example</title></head><body>${"Navigation and missing-page filler. ".repeat(20)}</body></html>`,
      ),
    },
    {
      name: "a malformed PDF payload",
      page: {
        body: new TextEncoder().encode(
          `%PDF-invalid\n${"binary-looking payload ".repeat(30)}`,
        ),
        contentType: "application/pdf",
      },
    },
  ] satisfies Array<{ name: string; page: ScrapingAntPage }>)(
    "escalates $name returned by the cheap request",
    async ({ page }) => {
      const harness = createHarness()
      harness.fetchPage
        .mockResolvedValueOnce({ ...page, credits: 1 })
        .mockResolvedValueOnce(htmlPage(usableHtml("Browser result"), {
          credits: 10,
        }))

      const result = await harness.extract({ url: "https://example.com/page" })

      expect(harness.fetchPage).toHaveBeenCalledTimes(2)
      expect(result.retrievalMethod).toBe("scrapingant-browser-us")
      expect(harness.logs[0]).toEqual(
        expect.objectContaining({
          method: "scrapingant-http",
          outcome: "failure",
          credits: 1,
        }),
      )
    },
  )

  it("fails after logging both unsuccessful ScrapingAnt modes", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage("<p>short</p>", { credits: 1 }))
      .mockRejectedValueOnce(new Error("browser failed"))

    await expect(
      harness.extract({ url: "https://example.com/page" }),
    ).rejects.toThrow(
      "No retrieval method returned usable content for https://example.com/page",
    )
    expect(harness.logs).toHaveLength(2)
    expect(harness.logs.map(({ method, outcome }) => ({ method, outcome }))).toEqual([
      { method: "scrapingant-http", outcome: "failure" },
      { method: "scrapingant-browser-us", outcome: "failure" },
    ])
    expect(harness.logs[1]?.failure).toBe("browser failed")
  })

  it("records credit metadata on each flat attempt log", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage("<p>short</p>", {
        credits: 1,
      }))
      .mockResolvedValueOnce(htmlPage(usableHtml(), {
        credits: 10,
      }))

    await harness.extract({ url: "https://www.example.com/page" })

    expect(harness.logs).toEqual([
      {
        event: "page-retrieval-attempt",
        url: "https://www.example.com/page",
        domain: "www.example.com",
        method: "scrapingant-http",
        outcome: "failure",
        latencyMs: 10,
        credits: 1,
        failure: "Extracted content was shorter than 200 characters",
      },
      {
        event: "page-retrieval-attempt",
        url: "https://www.example.com/page",
        domain: "www.example.com",
        method: "scrapingant-browser-us",
        outcome: "success",
        latencyMs: 10,
        credits: 10,
      },
    ])
  })
})
