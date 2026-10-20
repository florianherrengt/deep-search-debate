import { describe, expect, it } from "vitest"
import { extractVisibleTextFromHtml } from "./htmlText.ts"

describe("extractVisibleTextFromHtml", () => {
  it("keeps article details and table rows while removing page chrome", () => {
    const text = extractVisibleTextFromHtml(`
      <html>
        <head><title>Browser title</title><meta content="metadata"></head>
        <body>
          <nav>Site navigation</nav>
          <main>
            <h1>Research findings</h1>
            <p>The published report describes the conditions for eligibility.</p>
            <table><tr><th>Region</th><th>Limit</th></tr><tr><td>North</td><td>42</td></tr></table>
            <script>const hidden = "must not appear";</script>
            <div class="cookie-banner">Accept cookies</div>
            <div aria-hidden="true">Hidden dialog text</div>
          </main>
        </body>
      </html>
    `)

    expect(text).toContain("Research findings")
    expect(text).toContain("published report describes the conditions")
    expect(text).toContain("Region | Limit")
    expect(text).toContain("North | 42")
    expect(text).not.toMatch(/Browser title|metadata|Site navigation|must not appear|Accept cookies|Hidden dialog text/)
  })

  it("normalizes whitespace and caps repeated boilerplate lines", () => {
    const text = extractVisibleTextFromHtml(`
      <main>
        <p>Free&nbsp;returns</p><p>Free   returns</p><p>Free returns</p>
        <p>Individual  terms remain readable.</p>
      </main>
    `)

    expect(text.match(/Free returns/g)).toHaveLength(2)
    expect(text).toContain("Individual terms remain readable.")
    expect(text).not.toContain("\u00a0")
  })
})
