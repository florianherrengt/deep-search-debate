import { afterEach, describe, expect, it, vi } from "vitest"
import type { PageFetchClient } from "./pageFetch.ts"
type PageFetchResult = Awaited<ReturnType<PageFetchClient["fetchPage"]>>
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
  metadata: Omit<PageFetchResult, "body"> = {},
): PageFetchResult {
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
  const fetchPage = vi.fn<PageFetchClient["fetchPage"]>()
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

  it("uses the cheap page fetch request when it returns usable content", async () => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValueOnce(htmlPage(usableHtml()))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(harness.fetchPage).toHaveBeenCalledExactlyOnceWith({
      url: "https://example.com/page",
      mode: "http",
      signal: undefined,
    })
    expect(result.retrievalMethod).toBe("http")
    expect(result.content).toContain("Useful evidence explains")
    expect(harness.logs).toEqual([
      {
        event: "page-retrieval-attempt",
        url: "https://example.com/page",
        domain: "example.com",
        method: "http",
        outcome: "success",
        latencyMs: 10,
        },
    ])
  })

  it("does not log page retrieval attempts by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const fetchPage = vi
      .fn<PageFetchClient["fetchPage"]>()
      .mockResolvedValueOnce(htmlPage(usableHtml()))
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
    harness.fetchPage.mockResolvedValueOnce(htmlPage(html))

    const result = await harness.extract({ url: "https://example.com/start/page" })

    expect(result.links).toEqual([
      { url: "https://example.com/docs/terms?coverage=full&region=GB", title: "Terms & conditions" },
      { url: "https://example.com/specifications", title: "Technical specifications" },
      { url: "https://cdn.example.com/manual.pdf", title: "Manual" },
      { url: "https://example.com/catalog", title: "Catalog" },
    ])
    expect(result.content).not.toContain("Catalog")
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
      harness.fetchPage.mockResolvedValueOnce(htmlPage(content, { contentType }))

      const result = await harness.extract({ url: "https://example.com/data.json" })

      expect(result.content).toBe(content)
      expect(result.links).toEqual([])
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
  ])("rejects $name while preserving fallback behavior", async ({ body }) => {
    const harness = createHarness()
    harness.fetchPage.mockResolvedValue({ body, contentType: "application/json" })

    await expect(harness.extract({ url: "https://example.com/data" })).rejects.toMatchObject({
      message: "No retrieval method returned usable content for https://example.com/data",
    })
    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual(["http", "browser"])
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
        })
      .mockResolvedValueOnce(htmlPage(usableHtml("Browser document"), {
        contentType: "text/html; charset=utf-8",
        }))

    const result = await harness.extract({ url: "https://example.com/image" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser",
    ])
    expect(result.content).toContain("Browser document explains")
    expect(harness.logs[0]).toMatchObject({
      outcome: "failure",
      failure: "Unsupported page content type: image/png",
    })
  })

  it("escalates the HTTP 200 Mozilla Client Challenge loading notice to Browserless", async () => {
    const harness = createHarness()
    const notice = "A required part of this site couldn’t load. This may be due to a browser extension, network issues, or browser settings. Please check your connection, disable any ad blockers, or try using a different browser."
    const challenge = `<html><head><title>Client Challenge</title></head><body><main><p>${notice}</p></main></body></html>`
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage(challenge))
      .mockResolvedValueOnce(htmlPage(usableHtml("Rendered Mozilla article")))

    const result = await harness.extract({ url: "https://example.com/protected" })

    expect(notice).toHaveLength(209)
    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser",
    ])
    expect(harness.logs[0]).toMatchObject({
      method: "http",
      outcome: "failure",
      failure: "Page contained an access-denied or anti-bot challenge",
    })
    expect(result.retrievalMethod).toBe("browserless")
    expect(result.content).toContain("Rendered Mozilla article explains")
  })

  it.each([
    "Browser MCP capability matrix",
    "GitHub - Agent360dk/browser-mcp: A 2FA code, a CAPTCHA, or a confirmation",
  ])(
    "keeps substantive CAPTCHA documentation usable under the title %s",
    async (title) => {
      const harness = createHarness()
      const explanation = "Browser MCP documents how to automate pages that may request a 2FA code, a CAPTCHA, or confirmation from the user. These are supported browser workflows, and the guide explains the capability boundaries, accessibility tradeoffs, and when the automation should wait for a person."
      const html = `<html><head><title>${title}</title></head><body><article><h1>Browser MCP capability matrix</h1><p>${explanation}</p></article></body></html>`
      harness.fetchPage.mockResolvedValue(htmlPage(html))

      const result = await harness.extract({ url: "https://example.com/captcha-guide" })

      expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
        "http",
      ])
      expect(result.retrievalMethod).toBe("http")
      expect(result.content).toContain("accessibility tradeoffs")
      expect(result.content).toContain("capability boundaries")
    },
  )

  it("escalates a substantive CAPTCHA verification wall to Browserless", async () => {
    const harness = createHarness()
    const instructions = "Solve the CAPTCHA to continue. Enter the six characters displayed in the image into the verification field. If you cannot read them, select the refresh icon to request another challenge. Do not include spaces. Submit the answer and wait for the page to confirm verification before continuing to the requested document."
    const wall = `<html><head><title>CAPTCHA verification required</title></head><body><main><h1>Solve the CAPTCHA to continue.</h1><p>${instructions}</p></main></body></html>`
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage(wall))
      .mockResolvedValueOnce(htmlPage(usableHtml("Rendered protected document")))

    const result = await harness.extract({ url: "https://example.com/verification" })

    expect(instructions.length).toBeGreaterThan(200)
    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser",
    ])
    expect(harness.logs[0]).toMatchObject({ method: "http", outcome: "failure" })
    expect(result.retrievalMethod).toBe("browserless")
    expect(result.content).toContain("Rendered protected document explains")
  })

  it("keeps an explanatory article titled How to solve a CAPTCHA usable", async () => {
    const harness = createHarness()
    const explanation = "A CAPTCHA is a challenge-response test used to distinguish people from automated traffic. This help article explains why a site may ask for one, how to request an accessible alternative, and what to do if the verification image cannot be read. The instructions describe the test without asking the reader to complete a live verification."
    const html = `<html><head><title>How to solve a CAPTCHA</title></head><body><article><h1>About CAPTCHA verification</h1><p>${explanation}</p></article></body></html>`
    harness.fetchPage.mockResolvedValue(htmlPage(html))

    const result = await harness.extract({ url: "https://example.com/help/captcha" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
    ])
    expect(result.retrievalMethod).toBe("http")
    expect(result.content).toContain("accessible alternative")
    expect(result.content).toContain("live verification")
  })

  it("keeps an article quoting the loading notice usable and excludes challenge text in scripts and styles", async () => {
    const harness = createHarness()
    const notice = "A required part of this site couldn’t load. This may be due to a browser extension, network issues, or browser settings. Please check your connection, disable any ad blockers, or try using a different browser."
    const html = `<html><head><title>Mozilla browser troubleshooting notes</title><style>.example::before { content: "CAPTCHA access denied"; }</style></head><body><article><h1>Understanding browser loading messages</h1><p>This article quotes a notice sometimes shown by a browser challenge: “${notice}” The message can also appear in troubleshooting discussions about extensions and network settings, where it is explanatory text rather than the response from a blocked page.</p><p>${"The article gives readers context for diagnosing browser behavior without treating every quoted warning as a live challenge. ".repeat(3)}</p><script>const challenge = "Access denied. Verify that you are human.";</script></article></body></html>`
    harness.fetchPage.mockResolvedValue(htmlPage(html))

    const result = await harness.extract({ url: "https://example.com/browser-notes" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
    ])
    expect(result.content).toContain("quoted warning as a live challenge")
    expect(result.content).not.toContain("CAPTCHA access denied")
    expect(result.content).not.toContain("Verify that you are human")
  })

  it("ignores NUL bytes confined to script and style while retaining visible HTML", async () => {
    const harness = createHarness()
    const html = `<html><head><title>Useful post</title><style>.x::after { content: "\0"; }</style></head><body><script>const hidden = "\0";</script><article><h1>Useful post</h1><p>${"The visible post explains practical findings and gives readers useful evidence for their research. ".repeat(4)}</p></article></body></html>`
    harness.fetchPage.mockResolvedValue(htmlPage(html, { contentType: "text/html; charset=utf-8" }))

    const result = await harness.extract({ url: "https://example.com/post" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
    ])
    expect(result.retrievalMethod).toBe("http")
    expect(result.content).toContain("visible post explains practical findings")
    expect(result.content).not.toContain("const hidden")
  })

  it.each(["text/html", "text/plain", undefined])(
    "still rejects a visible NUL in %s text and uses rendered content",
    async (contentType) => {
      const harness = createHarness()
      const visibleNul = usableHtml("Visible NUL document").replace(
        "concrete facts",
        `concrete\0 facts`,
      )
      harness.fetchPage
        .mockResolvedValueOnce(htmlPage(visibleNul, { contentType }))
        .mockResolvedValueOnce(htmlPage(usableHtml("Rendered clean document")))

      const result = await harness.extract({ url: "https://example.com/nul" })

      expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
        "http",
        "browser",
      ])
      expect(result.retrievalMethod).toBe("browserless")
      expect(result.content).toContain("Rendered clean document explains")
    },
  )

  it("retains an article wrapper with a popover-height CSS utility and still prunes actual page chrome", async () => {
    const harness = createHarness()
    const html = usableHtml("Documentation wrapper")
      .replace(
        "<body>",
        '<body><div class="[--fd-toc-popover-height:0px]">',
      )
      .replace(
        "</body>",
        '</div><div class="popover [--fd-toc-popover-height:0px]">Open contents menu</div><div role="dialog">Cookie settings dialog</div><div class="cookie-banner">Accept cookies</div></body>',
      )
    harness.fetchPage.mockResolvedValue(htmlPage(html))

    const result = await harness.extract({ url: "https://example.com/docs" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
    ])
    expect(result.content).toContain("Documentation wrapper explains")
    expect(result.content).not.toContain("Open contents menu")
    expect(result.content).not.toContain("Cookie settings dialog")
    expect(result.content).not.toContain("Accept cookies")
  })

  it("logs a failed cheap request before escalating to browser rendering", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockRejectedValueOnce(new Error("provider transport failed"))
      .mockResolvedValueOnce(htmlPage(usableHtml("Rendered evidence"), {
        }))

    const result = await harness.extract({ url: "https://example.com/page" })

    expect(harness.fetchPage.mock.calls.map(([call]) => call.mode)).toEqual([
      "http",
      "browser",
    ])
    expect(result.retrievalMethod).toBe("browserless")
    expect(result.content).toContain("Rendered evidence explains")
    expect(harness.logs).toEqual([
      expect.objectContaining({
        method: "http",
        outcome: "failure",
        latencyMs: 10,
        failure: "provider transport failed",
      }),
      expect.objectContaining({
        method: "browserless",
        outcome: "success",
        latencyMs: 10,
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
  ] satisfies Array<{ name: string; page: PageFetchResult }>)(
    "escalates $name returned by the cheap request",
    async ({ page }) => {
      const harness = createHarness()
      harness.fetchPage
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce(htmlPage(usableHtml("Browser result")))

      const result = await harness.extract({ url: "https://example.com/page" })

      expect(harness.fetchPage).toHaveBeenCalledTimes(2)
      expect(result.retrievalMethod).toBe("browserless")
      expect(harness.logs[0]).toEqual(
        expect.objectContaining({
          method: "http",
          outcome: "failure",
            }),
      )
    },
  )

  it("fails after logging both unsuccessful page fetch modes", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage("<p>short</p>"))
      .mockRejectedValueOnce(new Error("browser failed"))

    await expect(
      harness.extract({ url: "https://example.com/page" }),
    ).rejects.toThrow(
      "No retrieval method returned usable content for https://example.com/page",
    )
    expect(harness.logs).toHaveLength(2)
    expect(harness.logs.map(({ method, outcome }) => ({ method, outcome }))).toEqual([
      { method: "http", outcome: "failure" },
      { method: "browserless", outcome: "failure" },
    ])
    expect(harness.logs[1]?.failure).toBe("browser failed")
  })

  it("records flat retrieval attempt logs without billing metadata", async () => {
    const harness = createHarness()
    harness.fetchPage
      .mockResolvedValueOnce(htmlPage("<p>short</p>", {
        }))
      .mockResolvedValueOnce(htmlPage(usableHtml(), {
        }))

    await harness.extract({ url: "https://www.example.com/page" })

    expect(harness.logs).toEqual([
      {
        event: "page-retrieval-attempt",
        url: "https://www.example.com/page",
        domain: "www.example.com",
        method: "http",
        outcome: "failure",
        latencyMs: 10,
          failure: "Extracted content was shorter than 200 characters",
      },
      {
        event: "page-retrieval-attempt",
        url: "https://www.example.com/page",
        domain: "www.example.com",
        method: "browserless",
        outcome: "success",
        latencyMs: 10,
        },
    ])
  })
})
