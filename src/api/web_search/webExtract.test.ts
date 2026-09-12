import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ScrapingAntClient,
  ScrapingAntPage,
} from "./scrapingAnt.ts"
import {
  createWebExtractor,
  type PageRetrievalLog,
} from "./webExtract.ts"
import { MAX_WEB_SEARCH_RESULTS, MAX_WEB_SEARCH_TITLE_CHARS } from "./types.ts"

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
  afterEach(() => vi.restoreAllMocks())

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

  it("does not log page retrieval attempts by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const fetchPage = vi
      .fn<ScrapingAntClient["fetchPage"]>()
      .mockResolvedValueOnce(htmlPage(usableHtml(), { credits: 1 }))
    const extract = createWebExtractor({ client: { fetchPage } })

    await extract({ url: "https://example.com/page" })

    expect(info).not.toHaveBeenCalled()
  })

  it("preserves discovered anchor links before text cleanup and resolves the document base", async () => {
    const harness = createHarness()
    const html = usableHtml()
      .replace("<head>", `<head>
        <!-- <base href="https://wrong.example/"> -->
        <script>const example = '<base href="https://wrong.example/">';</script>
        <base href="/docs/">
        <base href="https://ignored.example/">`)
      .replace("</main>", `
        <!-- <a href="/comment">Comment example</a> -->
        <script>const example = '<a href="/script">Script example</a>';</script>
        <style>.example::after { content: '<a href="/style">Style example</a>'; }</style>
        <textarea><a href="/textarea">Text example</a></textarea>
        <div title="<a href='/attribute'>Attribute example</a>">Text</div>
        <a title="Terms > details" data-note='href="/wrong"'
          href="terms?coverage=full&amp;region=GB#details">Terms &amp; <strong>conditions</strong></a>
        <a href=&#47;specifications>Technical &#x73;pecifications</a>
        <a href="//cdn.example.com/manual.pdf">Manual</a>
        </main><nav><a href="/catalog">Catalog</a></nav>`)
    harness.fetchPage.mockResolvedValueOnce(htmlPage(html, { credits: 1 }))

    const result = await harness.extract({ url: "https://example.com/start/page" })

    expect(result.links).toEqual([
      { url: "https://example.com/docs/terms?coverage=full&region=GB", title: "Terms & conditions" },
      { url: "https://example.com/specifications", title: "Technical specifications" },
      { url: "https://cdn.example.com/manual.pdf", title: "Manual" },
      { url: "https://example.com/catalog", title: "Catalog" },
    ])
    expect(result.content).not.toContain("Catalog")
    expect(result.scrapingAntCredits).toBe(1)
    expect(harness.fetchPage).toHaveBeenCalledTimes(1)
  })

  it("keeps only canonical unique public HTTPS links to other resources", async () => {
    const harness = createHarness()
    const hrefs = [
      "", "#details", "/page#details", "/page/?utm_source=source",
      "mailto:test@example.com", "javascript:alert(1)", "&#106;avascript:alert(1)",
      "http://example.com/plain", "https://localhost/private", "https://127.0.0.1/private",
      "https://10.0.0.1/private", "https://[::1]/private", "https://example.local/private",
      "https://user:password@example.com/private", "https://[malformed]/",
      "https://EXAMPLE.com/manual/?utm_source=source#intro", "https://example.com/manual",
      `/oversized?value=${"x".repeat(2_048)}`,
    ]
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml().replace(
      "</main>",
      `${hrefs.map((href) => `<a href="${href}">Manual</a>`).join("")}</main>`,
    )))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(result.links).toEqual([{ url: "https://example.com/manual", title: "Manual" }])
  })

  it("bounds discovered link count and titles", async () => {
    const harness = createHarness()
    const anchors = Array.from({ length: MAX_WEB_SEARCH_RESULTS + 5 }, (_, index) =>
      `<a href="item-${index}">${"t".repeat(MAX_WEB_SEARCH_TITLE_CHARS + 20)}</a>`,
    ).join("")
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml()
      .replace("</main>", `${anchors}</main>`)))

    const result = await harness.extract({ url: "https://example.com/docs/page" })

    expect(result.links).toHaveLength(MAX_WEB_SEARCH_RESULTS)
    expect(result.links[0]).toEqual({
      url: "https://example.com/docs/item-0",
      title: "t".repeat(MAX_WEB_SEARCH_TITLE_CHARS),
    })
    expect(result.links.at(-1)?.url).toBe(`https://example.com/docs/item-${MAX_WEB_SEARCH_RESULTS - 1}`)
  })

  it("finds primary evidence after hundreds of navigation links before applying the limit", async () => {
    const harness = createHarness()
    const navigation = Array.from({ length: 300 }, (_, index) =>
      `<a href="/navigation-${index}">Navigation ${index}</a>`,
    ).join("")
    const html = usableHtml()
      .replace("<body>", `<body><header><nav>${navigation}</nav></header><a href="/background">Background</a>`)
      .replace("</main>", '<a href="/evidence">Primary evidence</a><div role="navigation"><a href="/sidebar">Sidebar</a></div></main>')
    harness.fetchPage.mockResolvedValueOnce(htmlPage(html))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(result.links).toHaveLength(MAX_WEB_SEARCH_RESULTS)
    expect(result.links.slice(0, 3)).toEqual([
      { url: "https://example.com/evidence", title: "Primary evidence" },
      { url: "https://example.com/background", title: "Background" },
      { url: "https://example.com/navigation-0", title: "Navigation 0" },
    ])
  })

  it("prefers descriptive body duplicates while retaining footer-only terms", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml()
      .replace("<body>", '<body><nav><a href="/terms?utm_source=menu">Menu terms</a></nav>')
      .replace("</main>", '<a href="/terms">Eligibility terms and exclusions</a></main>')
      .replace("</body>", '<footer><a href="/policy">Published policy</a></footer></body>')))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(result.links).toEqual([
      { url: "https://example.com/terms", title: "Eligibility terms and exclusions" },
      { url: "https://example.com/policy", title: "Published policy" },
    ])
  })

  it("discovers advertised JSON documents without inventing endpoints or accepting private advertisements", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml().replace("<head>", `<head>
      <base href="/data/">
      <!-- <link type="application/json" href="/comment"> -->
      <script>const example = '<link type="application/json" href="/script">';</script>
      <link rel="alternate" type="application/json" href="inventory" title="Inventory &amp; availability">
      <link rel="alternate" type="application/ld+json" href="metadata" title="Metadata">
      <link type="application/json" href="https://127.0.0.1/private">
      <link type="application/json" href="javascript:alert(1)">
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" type="text/html" href="/other-page">`)))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(result.links).toEqual([
      { url: "https://example.com/data/inventory", title: "Inventory & availability" },
      { url: "https://example.com/data/metadata", title: "Metadata" },
    ])
  })

  it.each(["application/json; charset=utf-8", "application/ld+json", "application/vnd.api+json"])(
    "preserves short %s documents exactly, including numbers and escaped markup",
    async (contentType) => {
      const harness = createHarness()
      const content = ' {"id":9007199254740993,"price":14.00,"scale":1e-20,"available":false,"note":null,"label":"<a href=\\"/fake\\">A &amp; B</a>","magic":"%PDF-"}\n'
      harness.fetchPage.mockResolvedValueOnce(htmlPage(content, { contentType, credits: 1 }))

      const result = await harness.extract({ url: "https://example.com/data.json" })

      expect(result.content).toBe(content)
      expect(result.links).toEqual([])
      expect(result.scrapingAntCredits).toBe(1)
      expect(harness.fetchPage).toHaveBeenCalledTimes(1)
    },
  )

  it("retains a JSON document at the persisted content limit without truncating fields", async () => {
    const harness = createHarness()
    const content = JSON.stringify({ value: "x".repeat(100_000 - 12) })
    harness.fetchPage.mockResolvedValueOnce(htmlPage(content, { contentType: "application/json" }))

    expect(content).toHaveLength(100_000)
    expect((await harness.extract({ url: "https://example.com/data" })).content).toBe(content)
  })

  it.each([
    { name: "malformed JSON", body: new TextEncoder().encode('{"incomplete":') },
    { name: "prototype properties", body: new TextEncoder().encode('{"nested":{"__proto__":{"polluted":true}}}') },
    { name: "oversized JSON", body: new TextEncoder().encode(JSON.stringify({ value: "x".repeat(100_000 - 11) })) },
    { name: "invalid UTF-8 inside otherwise valid JSON", body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]) },
  ])("rejects $name while retaining retrieval costs and fallback behavior", async ({ body }) => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValue({ body, contentType: "application/json", credits: 1 })

    await expect(harness.extract({ url: "https://example.com/data" })).rejects.toMatchObject({
      message: "No retrieval method returned usable content for https://example.com/data",
      scrapingAntCredits: 2,
    })
    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual(["http", "browser-us"])
    expect(harness.logs.map(({ outcome }) => outcome)).toEqual(["failure", "failure"])
  })

  it("rejects relative links resolving through a private base without changing their destination", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml()
      .replace("<head>", '<head><base href="https://localhost/private/">')
      .replace("</main>", '<a href="manual">Private manual</a><a href="https://example.com/public">Public manual</a></main>')))

    const result = await harness.extract({ url: "https://example.com/docs/page" })

    expect(result.links).toEqual([{ url: "https://example.com/public", title: "Public manual" }])
  })

  it("does not interpret anchor-like text in a plain-text document as links", async () => {
    const harness = createHarness()
    const content = `${"Document evidence. ".repeat(20)}<a href="https://example.com/manual">Example markup</a>`
    harness.fetchPage.mockResolvedValueOnce(htmlPage(content, { contentType: "text/plain" }))

    const result = await harness.extract({ url: "https://example.com/readme.txt" })

    expect(result.content).toBe(content)
    expect(result.links).toEqual([])
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
    expect(result.links).toEqual([])
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
