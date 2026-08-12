import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { SITE_URL, truncateDescription, useSeo } from "./seo.ts"

function metaContent(attribute: "name" | "property", key: string): string | null {
  return (
    document.head.querySelector(`meta[${attribute}="${key}"]`)?.getAttribute(
      "content",
    ) ?? null
  )
}

function canonicalHref(): string | null {
  return (
    document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
    null
  )
}

describe("useSeo", () => {
  beforeEach(() => {
    document.head
      .querySelectorAll(
        'meta[name], meta[property], link[rel="canonical"], script[data-seo-json-ld]',
      )
      .forEach((element) => {
        element.remove()
      })
    document.title = "default"
    delete document.documentElement.dataset.seoPage
  })

  it("sets title, description, canonical, and share metadata", () => {
    renderHook(() =>
      useSeo({
        title: "Is nuclear power worth it? — RethinkLoop",
        description: "A researched debate between AI agents.",
        path: "/debates/is-nuclear-power-worth-it",
        openGraphType: "article",
      }),
    )

    expect(document.title).toBe("Is nuclear power worth it? — RethinkLoop")
    expect(metaContent("name", "description")).toBe(
      "A researched debate between AI agents.",
    )
    expect(metaContent("name", "robots")).toBe("index, follow")
    expect(canonicalHref()).toBe(
      `${SITE_URL}/debates/is-nuclear-power-worth-it`,
    )
    expect(metaContent("property", "og:title")).toBe(
      "Is nuclear power worth it? — RethinkLoop",
    )
    expect(metaContent("property", "og:url")).toBe(
      `${SITE_URL}/debates/is-nuclear-power-worth-it`,
    )
    expect(metaContent("property", "og:type")).toBe("article")
    expect(metaContent("name", "twitter:title")).toBe(
      "Is nuclear power worth it? — RethinkLoop",
    )
  })

  it("marks private pages noindex", () => {
    renderHook(() =>
      useSeo({ title: "Debates — RethinkLoop", noindex: true }),
    )

    expect(metaContent("name", "robots")).toBe("noindex, nofollow")
    expect(canonicalHref()).toBeNull()
  })

  it("URL-encodes canonical paths", () => {
    renderHook(() =>
      useSeo({
        title: "Tokyo housing — RethinkLoop",
        path: "/debates/東京の住宅政策",
      }),
    )

    expect(canonicalHref()).toBe(
      `${SITE_URL}/debates/%E6%9D%B1%E4%BA%AC%E3%81%AE%E4%BD%8F%E5%AE%85%E6%94%BF%E7%AD%96`,
    )
  })

  it("updates metadata when the page changes", () => {
    const { rerender } = renderHook(
      ({ path }: { path: string }) =>
        useSeo({
          title: "RethinkLoop — AI idea tournaments",
          description: "Landing description",
          path,
        }),
      { initialProps: { path: "/" } },
    )

    rerender({ path: "/terms" })

    expect(canonicalHref()).toBe(`${SITE_URL}/terms`)
  })

  it("preserves matching server metadata while route data loads", () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSeo({
          title: enabled ? "Loaded debate" : "Loading debate",
          path: enabled ? "/debates/current" : undefined,
          pageKey: "/debates/current",
          noindex: !enabled,
          enabled,
        }),
      { initialProps: { enabled: true } },
    )

    rerender({ enabled: false })

    expect(document.title).toBe("Loaded debate")
    expect(canonicalHref()).toBe(`${SITE_URL}/debates/current`)
    expect(metaContent("name", "robots")).toBe("index, follow")
  })

  it("replaces stale metadata when another route starts loading", () => {
    const { rerender } = renderHook(
      ({ enabled, pageKey }: { enabled: boolean; pageKey: string }) =>
        useSeo({
          title: enabled ? "Loaded debate" : "Loading debate — RethinkLoop",
          path: enabled ? pageKey : undefined,
          pageKey,
          noindex: !enabled,
          enabled,
        }),
      {
        initialProps: { enabled: true, pageKey: "/debates/first" },
      },
    )

    rerender({ enabled: false, pageKey: "/debates/second" })

    expect(document.title).toBe("Loading debate — RethinkLoop")
    expect(canonicalHref()).toBeNull()
    expect(metaContent("name", "robots")).toBe("noindex, nofollow")
  })

  it("injects JSON-LD and replaces it on change", () => {
    const { rerender } = renderHook(
      ({ headline }: { headline: string }) =>
        useSeo({
          title: headline,
          path: "/debates/foo",
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Article",
            headline,
          },
        }),
      { initialProps: { headline: "First" } },
    )

    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toHaveTextContent('"First"')
    expect(
      document.head.querySelectorAll('script[data-seo-json-ld="true"]'),
    ).toHaveLength(1)

    act(() => rerender({ headline: "Second" }))

    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toHaveTextContent('"Second"')
    expect(
      document.head.querySelectorAll('script[data-seo-json-ld="true"]'),
    ).toHaveLength(1)
  })
})

describe("truncateDescription", () => {
  it("keeps short text as-is", () => {
    expect(truncateDescription("Short prompt")).toBe("Short prompt")
  })

  it("truncates at a word boundary", () => {
    const text = "word ".repeat(100).trim()
    const result = truncateDescription(text, 40)
    expect(result.length).toBeLessThanOrEqual(41)
    expect(result.endsWith("…")).toBe(true)
  })

  it("collapses whitespace", () => {
    expect(truncateDescription("  a\n\t b  ")).toBe("a b")
  })
})
