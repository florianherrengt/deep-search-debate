import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs as debateJobsTable,
  debateMatches as debateMatchesTable,
  debateRounds as debateRoundsTable,
  deepSearchJobs as deepSearchJobsTable,
  deepSearchRounds as deepSearchRoundsTable,
  ideaJobs as ideaJobsTable,
  ideas as ideasTable,
  llmGenerations as llmGenerationsTable,
} from "../db/schema/index.ts"
import { app } from "../index.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "./debates/tournament.ts"
import {
  renderSeoDocument,
  resolveSeoPage,
  seoPages,
} from "./seo.ts"
import type { AppEnv } from "../types/auth.ts"

type SeededIdea = {
  description: string
  ideaId: string
  title: string
}

function seedDebate(options: {
  slug: string
  debateJobId: string
  ideaJobId: string
  isPublic?: boolean
  status?: "running" | "completed" | "failed"
  deepSearch?: { slug: string; deepSearchJobId: string }
  ideas?: SeededIdea[]
}) {
  const status = options.status ?? "running"
  db.insert(debateJobsTable)
    .values({
      userId: "test-user-id",
      debateJobId: options.debateJobId,
      randomSeed: 1,
      isPublic: options.isPublic ?? false,
      stage: status === "completed" ? "final" : undefined,
      status,
      error: status === "failed" ? "Seeded failure" : undefined,
      completedAt:
        status === "completed" || status === "failed" ? new Date() : undefined,
    })
    .run()
  db.insert(ideaJobsTable)
    .values({
      userId: "test-user-id",
      ideaJobId: options.ideaJobId,
      debateJobId: options.debateJobId,
      title: `Run for ${options.slug}`,
      slug: options.slug,
      prompt: `Prompt for ${options.slug}`,
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      deepSearchCount: 2,
      maxSearches: 8,
      maxResultsPerSearch: 10,
      maxRounds: 3,
    })
    .run()
  if (options.deepSearch) {
    db.insert(deepSearchJobsTable)
      .values({
        userId: "test-user-id",
        deepSearchJobId: options.deepSearch.deepSearchJobId,
        ideaJobId: options.ideaJobId,
        ideaJobPosition: 0,
        title: `Research for ${options.slug}`,
        slug: options.deepSearch.slug,
        researchRequest: "Research request",
        maxSearches: 8,
        maxResultsPerSearch: 10,
        strictQuality: true,
      })
      .run()
  }
  if (options.ideas && options.ideas.length > 0) {
    db.insert(ideasTable)
      .values(
        options.ideas.map((idea, position) => ({
          ...idea,
          ideaJobId: options.ideaJobId,
          position,
        })),
      )
      .run()
  }
}

function seedMatch(options: {
  debateJobId: string
  firstIdeaId: string
  matchId: string
  secondIdeaId: string
}): void {
  const debateRoundId = crypto.randomUUID()
  db.insert(debateRoundsTable)
    .values({
      debateRoundId,
      debateJobId: options.debateJobId,
      stage: "swiss",
      stageRoundNumber: 1,
    })
    .run()
  db.insert(debateMatchesTable)
    .values({
      debateMatchId: options.matchId,
      debateRoundId,
      position: 0,
      firstIdeaId: options.firstIdeaId,
      secondIdeaId: options.secondIdeaId,
    })
    .run()
}

function seedDebateWithMatch(options: {
  isPublic: boolean
  matchId: string
  slug: string
}): void {
  const debateJobId = crypto.randomUUID()
  const firstIdeaId = crypto.randomUUID()
  const secondIdeaId = crypto.randomUUID()
  seedDebate({
    slug: options.slug,
    debateJobId,
    ideaJobId: crypto.randomUUID(),
    isPublic: options.isPublic,
    status: "completed",
    ideas: [
      {
        ideaId: firstIdeaId,
        title: "First idea",
        description: "First description",
      },
      {
        ideaId: secondIdeaId,
        title: "Second idea",
        description: "Second description",
      },
    ],
  })
  seedMatch({
    debateJobId,
    firstIdeaId,
    matchId: options.matchId,
    secondIdeaId,
  })
}

function seedDeepSearchRound(options: {
  deepSearchJobId: string
  position: number
}): void {
  const llmGenerationId = crypto.randomUUID()
  db.insert(llmGenerationsTable)
    .values({
      deepSearchJobId: options.deepSearchJobId,
      llmGenerationId,
      userId: "test-user-id",
    })
    .run()
  db.insert(deepSearchRoundsTable)
    .values({
      deepSearchJobId: options.deepSearchJobId,
      deepSearchRoundId: crypto.randomUUID(),
      llmGenerationId,
      position: options.position,
    })
    .run()
}

function createSeoApp(debateJobIds: readonly string[] = []): Hono<AppEnv> {
  const seoApp = new Hono<AppEnv>()
  seoPages(seoApp, debateJobIds)
  return seoApp
}

beforeEach(() => {
  db.delete(debateJobsTable).run()
  db.delete(ideaJobsTable).run()
  db.delete(deepSearchJobsTable).run()
})

describe("robots.txt", () => {
  it("allows crawling and points at the canonical sitemap URL", async () => {
    const response = await app.request("/robots.txt")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/plain")
    expect(await response.text()).toBe(`User-agent: *
Allow: /

Sitemap: ${new URL("/sitemap.xml", config.auth.baseUrl).href}
`)
  })
})

describe("sitemap.xml", () => {
  it("lists only selected, completed public content, including individual ideas", async () => {
    const ideaId = "33333333-3333-4333-8333-333333333333"
    const debateJobId = "11111111-1111-4111-8111-111111111111"
    seedDebate({
      slug: "is-nuclear-power-worth-it",
      debateJobId,
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: true,
      status: "completed",
      deepSearch: {
        slug: "nuclear-power-evidence",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
      },
      ideas: [
        {
          ideaId,
          title: "Build smaller reactors",
          description: "A concrete proposal.",
        },
      ],
    })

    const response = await createSeoApp([debateJobId]).request("/sitemap.xml")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("application/xml")
    const body = await response.text()
    const baseUrl = config.auth.baseUrl

    for (const path of [
      "/",
      "/examples",
      "/debates/is-nuclear-power-worth-it",
      "/ideas/is-nuclear-power-worth-it",
      `/ideas/is-nuclear-power-worth-it/${ideaId}`,
      "/deep-search/nuclear-power-evidence",
    ]) {
      expect(body).toContain(
        `<loc>${new URL(path, baseUrl).href}</loc>`,
      )
    }
    expect(body).not.toContain("/terms")
    expect(body).not.toContain("/privacy")
  })

  it("does not promote an unselected completed public debate", async () => {
    seedDebate({
      slug: "unselected-public-debate",
      debateJobId: "66666666-6666-4666-8666-666666666666",
      ideaJobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      isPublic: true,
      status: "completed",
    })

    const body = await (await createSeoApp().request("/sitemap.xml")).text()

    expect(body).toContain(
      `<loc>${new URL("/examples", config.auth.baseUrl).href}</loc>`,
    )
    expect(body).not.toContain("unselected-public-debate")
  })

  it("excludes private, running, and failed debates", async () => {
    seedDebate({
      slug: "private-debate",
      debateJobId: "11111111-1111-4111-8111-111111111111",
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: false,
      status: "completed",
    })
    seedDebate({
      slug: "running-debate",
      debateJobId: "33333333-3333-4333-8333-333333333333",
      ideaJobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      isPublic: true,
      status: "running",
    })
    seedDebate({
      slug: "failed-debate",
      debateJobId: "44444444-4444-4444-8444-444444444444",
      ideaJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      isPublic: true,
      status: "failed",
    })

    const body = await (
      await createSeoApp([
        "11111111-1111-4111-8111-111111111111",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      ]).request("/sitemap.xml")
    ).text()

    expect(body).not.toContain("private-debate")
    expect(body).not.toContain("running-debate")
    expect(body).not.toContain("failed-debate")
  })

  it("URL-encodes Unicode slugs before XML escaping", async () => {
    seedDebate({
      slug: "東京の住宅政策",
      debateJobId: "55555555-5555-4555-8555-555555555555",
      ideaJobId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      isPublic: true,
      status: "completed",
    })

    const body = await (
      await createSeoApp([
        "55555555-5555-4555-8555-555555555555",
      ]).request("/sitemap.xml")
    ).text()

    expect(body).toContain(
      `<loc>${config.auth.baseUrl}/debates/%E6%9D%B1%E4%BA%AC%E3%81%AE%E4%BD%8F%E5%AE%85%E6%94%BF%E7%AD%96</loc>`,
    )
    expect(body).not.toContain("東京の住宅政策")
  })
})

describe("resolveSeoPage", () => {
  it("serves the hidden sign-in route as an unindexed application page", () => {
    expect(
      resolveSeoPage("/8f917f11-9443-4241-b741-6320492608c5", null),
    ).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: null,
        noindex: true,
        title: "Sign in — RethinkLoop",
      },
    })
  })

  it("serves the merged admin route as a private application page", () => {
    expect(resolveSeoPage("/admin/credits", "admin-user-id")).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: null,
        noindex: true,
        title: "Admin Credits — RethinkLoop",
      },
    })
  })

  it.each([
    ["/terms", "Terms & Conditions"],
    ["/privacy", "Privacy Policy"],
  ])("describes the published legal page at %s", (path, title) => {
    expect(resolveSeoPage(path, null)).toMatchObject({
      kind: "page",
      metadata: {
        description: `${title} for RethinkLoop, a research and decision workspace for questions that need more than one model response.`,
        noindex: true,
      },
    })
  })

  it("provides canonical metadata for the public examples page", () => {
    expect(resolveSeoPage("/examples", null)).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: `${config.auth.baseUrl}/examples`,
        noindex: false,
        title: "Examples — RethinkLoop",
      },
    })
  })

  it("serves private resources to their owner with noindex and hides them from others", () => {
    seedDebate({
      slug: "private-debate",
      debateJobId: "11111111-1111-4111-8111-111111111111",
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: false,
      status: "completed",
    })

    expect(resolveSeoPage("/debates/private-debate", "test-user-id")).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: null,
        noindex: true,
        title: "Run for private-debate — RethinkLoop",
      },
    })
    expect(resolveSeoPage("/debates/private-debate", null)).toEqual({
      kind: "not-found",
    })
    expect(resolveSeoPage("/debates/private-debate", "other-user")).toEqual({
      kind: "not-found",
    })
  })

  it("marks public unfinished resources noindex until the root debate completes", () => {
    seedDebate({
      slug: "running-debate",
      debateJobId: "11111111-1111-4111-8111-111111111111",
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: true,
      status: "running",
    })

    expect(resolveSeoPage("/debates/running-debate", null)).toMatchObject({
      kind: "page",
      metadata: {
        noindex: true,
      },
    })
  })

  it.each([
    "/debates/public-debate/matches/44444444-4444-4444-8444-444444444444",
    "/debates/public-debate/matches/44444444-4444-4444-8444-444444444444/",
  ])("resolves a public match reload at %s with its parent debate metadata", (path) => {
    const debateJobId = "11111111-1111-4111-8111-111111111111"
    const firstIdeaId = "22222222-2222-4222-8222-222222222222"
    const secondIdeaId = "33333333-3333-4333-8333-333333333333"
    seedDebate({
      slug: "public-debate",
      debateJobId,
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: true,
      status: "completed",
      ideas: [
        {
          ideaId: firstIdeaId,
          title: "First idea",
          description: "First description",
        },
        {
          ideaId: secondIdeaId,
          title: "Second idea",
          description: "Second description",
        },
      ],
    })
    seedMatch({
      debateJobId,
      firstIdeaId,
      matchId: "44444444-4444-4444-8444-444444444444",
      secondIdeaId,
    })

    expect(resolveSeoPage(path, null)).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: `${config.auth.baseUrl}/debates/public-debate`,
        description: "Prompt for public-debate",
        noindex: false,
        title: "Run for public-debate — RethinkLoop",
      },
    })
  })

  it("does not disclose malformed, missing, foreign, or private matches", () => {
    seedDebateWithMatch({
      isPublic: true,
      matchId: "55555555-5555-4555-8555-555555555555",
      slug: "other-public-debate",
    })
    seedDebateWithMatch({
      isPublic: false,
      matchId: "66666666-6666-4666-8666-666666666666",
      slug: "private-debate",
    })
    seedDebate({
      slug: "named-public-debate",
      debateJobId: "77777777-7777-4777-8777-777777777777",
      ideaJobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      isPublic: true,
      status: "completed",
    })

    for (const path of [
      "/debates/named-public-debate/matches/not-a-uuid",
      "/debates/named-public-debate/matches/88888888-8888-4888-8888-888888888888",
      "/debates/named-public-debate/matches/55555555-5555-4555-8555-555555555555",
      "/debates/private-debate/matches/66666666-6666-4666-8666-666666666666",
    ]) {
      expect(resolveSeoPage(path, null)).toEqual({ kind: "not-found" })
    }
  })

  it("serves a private match only to its owner and marks it noindex", () => {
    const matchId = "99999999-9999-4999-8999-999999999999"
    seedDebateWithMatch({
      isPublic: false,
      matchId,
      slug: "owned-private-debate",
    })
    const path = `/debates/owned-private-debate/matches/${matchId}`

    expect(resolveSeoPage(path, "other-user-id")).toEqual({
      kind: "not-found",
    })
    expect(resolveSeoPage(path, "test-user-id")).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: null,
        noindex: true,
        title: "Run for owned-private-debate — RethinkLoop",
      },
    })
  })

  it.each([
    "/deep-search/public-research/rounds/1",
    "/deep-search/public-research/rounds/1/",
  ])(
    "resolves a public research round at %s with its parent metadata",
    (path) => {
      const deepSearchJobId = crypto.randomUUID()
      seedDebate({
        slug: "public-research-parent",
        debateJobId: crypto.randomUUID(),
        ideaJobId: crypto.randomUUID(),
        isPublic: true,
        status: "completed",
        deepSearch: { deepSearchJobId, slug: "public-research" },
      })
      seedDeepSearchRound({ deepSearchJobId, position: 0 })

      expect(resolveSeoPage(path, null)).toMatchObject({
        kind: "page",
        metadata: {
          canonicalUrl: `${config.auth.baseUrl}/deep-search/public-research`,
          description: "Research request",
          noindex: false,
          title: "Research for public-research-parent — RethinkLoop",
        },
      })
    },
  )

  it("serves a private research round only to its owner with noindex", () => {
    const deepSearchJobId = crypto.randomUUID()
    seedDebate({
      slug: "private-research-parent",
      debateJobId: crypto.randomUUID(),
      ideaJobId: crypto.randomUUID(),
      isPublic: false,
      status: "completed",
      deepSearch: { deepSearchJobId, slug: "private-research" },
    })
    seedDeepSearchRound({ deepSearchJobId, position: 0 })
    const path = "/deep-search/private-research/rounds/1"

    expect(resolveSeoPage(path, "test-user-id")).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: null,
        noindex: true,
        title: "Research for private-research-parent — RethinkLoop",
      },
    })
    expect(resolveSeoPage(path, null)).toEqual({ kind: "not-found" })
    expect(resolveSeoPage(path, "other-user-id")).toEqual({
      kind: "not-found",
    })
  })

  it("keeps a public research round noindex until its root debate completes", () => {
    const deepSearchJobId = crypto.randomUUID()
    seedDebate({
      slug: "running-research-parent",
      debateJobId: crypto.randomUUID(),
      ideaJobId: crypto.randomUUID(),
      isPublic: true,
      status: "running",
      deepSearch: { deepSearchJobId, slug: "running-research" },
    })
    seedDeepSearchRound({ deepSearchJobId, position: 0 })

    expect(
      resolveSeoPage("/deep-search/running-research/rounds/1", null),
    ).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: `${config.auth.baseUrl}/deep-search/running-research`,
        noindex: true,
      },
    })
  })

  it("does not disclose malformed, missing, or cross-job research rounds", () => {
    seedDebate({
      slug: "named-research-parent",
      debateJobId: crypto.randomUUID(),
      ideaJobId: crypto.randomUUID(),
      isPublic: true,
      status: "completed",
      deepSearch: {
        deepSearchJobId: crypto.randomUUID(),
        slug: "named-research",
      },
    })
    const foreignDeepSearchJobId = crypto.randomUUID()
    seedDebate({
      slug: "foreign-research-parent",
      debateJobId: crypto.randomUUID(),
      ideaJobId: crypto.randomUUID(),
      isPublic: true,
      status: "completed",
      deepSearch: {
        deepSearchJobId: foreignDeepSearchJobId,
        slug: "foreign-research",
      },
    })
    seedDeepSearchRound({
      deepSearchJobId: foreignDeepSearchJobId,
      position: 0,
    })

    for (const path of [
      "/deep-search/named-research/rounds/0",
      "/deep-search/named-research/rounds/-1",
      "/deep-search/named-research/rounds/1.5",
      "/deep-search/named-research/rounds/01",
      "/deep-search/named-research/rounds/+1",
      "/deep-search/named-research/rounds/9007199254740992",
      "/deep-search/named-research/rounds/not-a-number",
      "/deep-search/named-research/rounds/1",
      "/deep-search/named-research/rounds/2",
      "/deep-search/named-research/rounds",
      "/deep-search/named-research/rounds/1/extra",
    ]) {
      expect(resolveSeoPage(path, null)).toEqual({ kind: "not-found" })
    }
  })

  it("resolves individual ideas and returns not-found for unknown nested IDs", () => {
    const ideaId = "33333333-3333-4333-8333-333333333333"
    seedDebate({
      slug: "public-ideas",
      debateJobId: "11111111-1111-4111-8111-111111111111",
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: true,
      status: "completed",
      ideas: [
        {
          ideaId,
          title: "A distinct idea",
          description: "Its own description for search results.",
        },
      ],
    })

    expect(
      resolveSeoPage(`/ideas/public-ideas/${ideaId}`, null),
    ).toMatchObject({
      kind: "page",
      metadata: {
        canonicalUrl: `${config.auth.baseUrl}/ideas/public-ideas/${ideaId}`,
        description: "Its own description for search results.",
        noindex: false,
        title: "A distinct idea — RethinkLoop",
      },
    })
    expect(
      resolveSeoPage(
        "/ideas/public-ideas/44444444-4444-4444-8444-444444444444",
        null,
      ),
    ).toEqual({ kind: "not-found" })
  })

  it("returns a hard not-found result for unknown application routes", () => {
    expect(resolveSeoPage("/missing", null)).toEqual({ kind: "not-found" })
  })
})

describe("resource visibility responses", () => {
  it("tells the client when inherited idea and deep-search resources are public", async () => {
    seedDebate({
      slug: "public-resources",
      debateJobId: "11111111-1111-4111-8111-111111111111",
      ideaJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      isPublic: true,
      status: "completed",
      deepSearch: {
        slug: "public-research",
        deepSearchJobId: "22222222-2222-4222-8222-222222222222",
      },
    })

    const [ideaResponse, deepSearchResponse] = await Promise.all([
      app.request("/api/idea-jobs/public-resources"),
      app.request("/api/deep-search-jobs/public-research"),
    ])

    await expect(ideaResponse.json()).resolves.toMatchObject({
      ideaJob: { isIndexable: true, isPublic: true },
    })
    await expect(deepSearchResponse.json()).resolves.toMatchObject({
      deepSearchJob: { isIndexable: true, isPublic: true },
    })
  })
})

describe("renderSeoDocument", () => {
  const template = `<!doctype html><html><head>
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://rethinkloop.com/" />
    <meta name="description" content="Home description" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Home title" />
    <meta property="og:description" content="Home description" />
    <meta property="og:url" content="https://rethinkloop.com/" />
    <meta name="twitter:title" content="Home title" />
    <meta name="twitter:description" content="Home description" />
    <title>Home title</title>
  </head><body><div id="root"></div></body></html>`

  it("puts public page metadata and safe JSON-LD into the initial HTML", () => {
    const html = renderSeoDocument(template, {
      canonicalUrl: "https://rethinkloop.com/debates/example",
      description: "A <researched> & useful debate.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "A </script><script>alert(1)</script> debate",
      },
      noindex: false,
      openGraphType: "article",
      title: "Example & evidence — RethinkLoop",
    }, "/debates/example")

    expect(html).toContain('data-seo-page="/debates/example"')
    expect(html).toContain("<title>Example &amp; evidence — RethinkLoop</title>")
    expect(html).toContain('name="robots" content="index, follow"')
    expect(html).toContain(
      'name="description" content="A &lt;researched&gt; &amp; useful debate."',
    )
    expect(html).toContain(
      'property="og:url" content="https://rethinkloop.com/debates/example"',
    )
    expect(html).toContain('property="og:type" content="article"')
    expect(html).toContain('data-seo-json-ld="true"')
    expect(html).toContain("\\u003c/script\\u003e")
    expect(html).not.toContain("</script><script>alert(1)</script>")
  })

  it("removes canonical and structured data from private pages", () => {
    const html = renderSeoDocument(template, {
      canonicalUrl: null,
      description: "Private content",
      jsonLd: undefined,
      noindex: true,
      openGraphType: "website",
      title: "Private page — RethinkLoop",
    })

    expect(html).toContain('name="robots" content="noindex, nofollow"')
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:url"')
    expect(html).not.toContain('data-seo-json-ld="true"')
  })
})
