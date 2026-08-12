import { Hono } from "hono"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "./db/index.ts"
import {
  debateJobs,
  ideaJobs,
} from "./db/schema/index.ts"
import { registerPublicDebatePage } from "./publicDebatePage.ts"
import type { AppEnv } from "./types/auth.ts"

const genericTitle = "RethinkLoop — AI idea tournaments"
const indexHtml = readFileSync(
  fileURLToPath(new URL("../web/index.html", import.meta.url)),
  "utf8",
)

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  registerPublicDebatePage(app, {
    indexHtml,
    publicBaseUrl: "https://debates.example/base-path",
  })
  return app
}

function insertDebate({
  isPublic,
  prompt,
  slug,
  title,
}: {
  isPublic: boolean
  prompt: string
  slug: string
  title: string
}): void {
  const debateJobId = crypto.randomUUID()
  db.insert(debateJobs)
    .values({
      debateJobId,
      userId: "test-user-id",
      randomSeed: 1,
      isPublic,
    })
    .run()
  db.insert(ideaJobs)
    .values({
      ideaJobId: crypto.randomUUID(),
      debateJobId,
      userId: "test-user-id",
      title,
      slug,
      prompt,
      numberOfIdeas: 12,
      deepSearchCount: 2,
    })
    .run()
}

describe("public debate HTML", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
  })

  it("renders escaped debate-specific Open Graph and Twitter metadata", async () => {
    insertDebate({
      isPublic: true,
      title: 'Clean <Energy> & "Storage"',
      slug: "clean-energy-storage",
      prompt: 'How should <cities> "store" energy & stay resilient?\nNow.',
    })

    const response = await createApp().request(
      "/debates/clean-energy-storage",
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(html).toContain(
      '<title>Clean &lt;Energy&gt; &amp; &quot;Storage&quot; — RethinkLoop</title>',
    )
    expect(html).toContain(
      '<meta property="og:type" content="article" />',
    )
    expect(html).toContain(
      '<meta property="og:title" content="Clean &lt;Energy&gt; &amp; &quot;Storage&quot; — RethinkLoop" />',
    )
    expect(html).toContain(
      '<meta property="og:description" content="Follow AI agents as they research and debate: How should &lt;cities&gt; &quot;store&quot; energy &amp; stay resilient? Now." />',
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://debates.example/debates/clean-energy-storage" />',
    )
    expect(html).toContain(
      '<meta property="og:image" content="https://debates.example/og-image.png" />',
    )
    expect(html).toContain(
      '<meta name="twitter:title" content="Clean &lt;Energy&gt; &amp; &quot;Storage&quot; — RethinkLoop" />',
    )
    expect(html).toContain(
      '<link rel="canonical" href="https://debates.example/debates/clean-energy-storage" />',
    )
    expect(html).not.toContain("<cities>")
    expect(html.match(/page-metadata:start/g)).toHaveLength(1)
    expect(html.match(/page-metadata:end/g)).toHaveLength(1)

    const trailingSlashHtml = await (
      await createApp().request("/debates/clean-energy-storage/")
    ).text()
    expect(trailingSlashHtml).toContain(
      '<meta property="og:url" content="https://debates.example/debates/clean-energy-storage" />',
    )
  })

  it.each([
    ["private", "private-debate"],
    ["unknown", "missing-debate"],
    ["malformed", "x".repeat(81)],
  ])("keeps generic metadata for a %s slug", async (_case, slug) => {
    insertDebate({
      isPublic: false,
      title: "Secret debate title",
      slug: "private-debate",
      prompt: "Secret debate prompt",
    })

    const response = await createApp().request(`/debates/${slug}`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(`<title>${genericTitle}</title>`)
    expect(html).not.toContain("Secret debate title")
    expect(html).not.toContain("Secret debate prompt")
  })
})
