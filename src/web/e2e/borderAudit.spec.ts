import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

/**
 * Temporary border-rounding audit (Phases 2-3 of the plan). Creates real
 * completed jobs through the API (external services are mocked by the
 * Playwright preload), then walks every rendered route at desktop and mobile
 * widths, collecting every element with a visible border or outline and its
 * corner radii. Writes findings to test-results/border-audit/. This spec
 * intentionally asserts nothing about findings; it only produces artifacts.
 */

const artifactDir = join(process.cwd(), "test-results", "border-audit")
mkdirSync(artifactDir, { recursive: true })

const webOrigin = process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174"

type JobKind = "deep-search" | "idea" | "debate"

async function createJobAndWait(
  request: APIRequestContext,
  kind: JobKind,
  body: Record<string, unknown>,
): Promise<string> {
  const base = kind === "deep-search" ? "deep-search" : kind
  const created = await request.post(`/api/${base}-jobs`, {
    data: body,
    headers: { Origin: webOrigin },
  })
  expect(
    created.status(),
    `POST /api/${base}-jobs should be accepted`,
  ).toBe(202)
  const createdBody = (await created.json()) as { slug: string }
  const slug = createdBody.slug

  let lastStatus = "unknown"
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const response = await request.get(
      `/api/${base}-jobs/${encodeURIComponent(slug)}`,
    )
    const payload = (await response.json()) as Record<
      string,
      { status?: string } | undefined
    >
    const job =
      payload.deepSearchJob ??
      payload.ideaJob ??
      payload.debateJob ??
      payload.tournament
    lastStatus = job?.status ?? "unknown"
    if (["completed", "failed", "interrupted"].includes(lastStatus)) break
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  expect(lastStatus, `${kind} job should complete`).toBe("completed")
  return slug
}

type AuditEntry = {
  tag: string
  className: string
  role: string | null
  text: string
  x: number
  y: number
  w: number
  h: number
  borderWidths: [number, number, number, number]
  radii: [string, string, string, string]
  outline: string
  outlineColor: string
  outlineWidth: string
  bgcolor: string
  isFirstChild: boolean
  isLastChild: boolean
  clippedBy: string | null
  clippedByRadius: string | null
  isActive: boolean
}

function collectBorderAudit(): AuditEntry[] {
  const entries: AuditEntry[] = []
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>("body *"),
  )
  for (const el of elements) {
    const style = getComputedStyle(el)
    const borderWidths: [number, number, number, number] = [
      parseFloat(style.borderTopWidth),
      parseFloat(style.borderRightWidth),
      parseFloat(style.borderBottomWidth),
      parseFloat(style.borderLeftWidth),
    ]
    const hasBorder = borderWidths.some((width) => width > 0)
    const hasOutline =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
    if (!hasBorder && !hasOutline) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    // Fully transparent elements (e.g. MUI Select's hidden native input with
    // opacity: 0) paint nothing and cannot have visible square corners.
    if (parseFloat(style.opacity) === 0) continue
    const radii: [string, string, string, string] = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ]
    const activeElement = document.activeElement as HTMLElement | null
    const isActive = activeElement === el
    let clippedBy: string | null = null
    let clippedByRadius: string | null = null
    let ancestor = el.parentElement
    for (let depth = 0; depth < 12 && ancestor !== null; depth += 1) {
      const ancestorStyle = getComputedStyle(ancestor)
      // Any non-visible overflow clips at the rounded border box; MUI's
      // TableContainer relies on overflow-x: auto to round the header band.
      if (
        (ancestorStyle.overflowX !== "visible" ||
          ancestorStyle.overflowY !== "visible") &&
        ancestorStyle.borderTopLeftRadius !== "0px"
      ) {
        clippedBy = `${ancestor.tagName.toLowerCase()}.${String(ancestor.className)}`.slice(
          0,
          160,
        )
        clippedByRadius = ancestorStyle.borderTopLeftRadius
        break
      }
      ancestor = ancestor.parentElement
    }
    entries.push({
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === "string" ? el.className : "",
      role: el.getAttribute("role"),
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      borderWidths,
      radii,
      outline: style.outlineStyle,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      bgcolor: style.backgroundColor,
      isFirstChild: el.parentElement?.firstElementChild === el,
      isLastChild: el.parentElement?.lastElementChild === el,
      clippedBy,
      clippedByRadius,
      isActive,
    })
  }
  return entries
}

type Classified = {
  /** Bordered element with all corners at radius 0, not auto-excluded. */
  suspects: AuditEntry[]
  /** Bordered, radius 0, excluded by a divider/full-bleed rule. */
  excludedDividers: AuditEntry[]
  /** Bordered, radius 0, clipped by a rounded overflow-hidden ancestor. */
  masked: AuditEntry[]
  /** Outline-only elements with radius 0. */
  outlines: AuditEntry[]
  /** Bordered, radius 0, element between accordion siblings (shared edge). */
  sharedAccordionEdges: AuditEntry[]
}

function classify(
  entries: AuditEntry[],
  viewportWidth: number,
): Classified {
  const suspects: AuditEntry[] = []
  const excludedDividers: AuditEntry[] = []
  const masked: AuditEntry[] = []
  const outlines: AuditEntry[] = []
  const sharedAccordionEdges: AuditEntry[] = []

  for (const entry of entries) {
    const bordered = entry.borderWidths.some((width) => width > 0)
    if (!bordered) {
      if (entry.radii.every((radius) => radius === "0px")) {
        outlines.push(entry)
      }
      continue
    }
    if (!entry.radii.every((radius) => radius === "0px")) continue

    if (entry.clippedBy !== null) {
      masked.push(entry)
      continue
    }

    const borderedSides = entry.borderWidths.filter((width) => width > 0).length
    const transparentBackground =
      entry.bgcolor === "rgba(0, 0, 0, 0)" || entry.bgcolor === "transparent"
    const fullBleed =
      borderedSides === 1 && entry.w >= viewportWidth * 0.98

    if (entry.className.includes("MuiAccordion-root")) {
      if (!entry.isFirstChild && !entry.isLastChild) {
        sharedAccordionEdges.push(entry)
        continue
      }
    }

    if ((transparentBackground || fullBleed) && borderedSides === 1) {
      excludedDividers.push(entry)
      continue
    }

    suspects.push(entry)
  }

  return { suspects, excludedDividers, masked, outlines, sharedAccordionEdges }
}

function signature(entry: AuditEntry): string {
  const sides = ["T", "R", "B", "L"]
    .map((side, index) =>
      entry.borderWidths[index] > 0 ? side : side.toLowerCase(),
    )
    .join("")
  const muiClass =
    entry.className.match(/Mui[A-Za-z]+-root/)?.[0] ?? entry.tag
  return `${muiClass} [${sides}] ${entry.bgcolor}`
}

function summarize(entries: AuditEntry[]): string {
  const counts = new Map<string, { count: number; example: AuditEntry }>()
  for (const entry of entries) {
    const key = signature(entry)
    const current = counts.get(key)
    if (current) {
      current.count += 1
    } else {
      counts.set(key, { count: 1, example: entry })
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, { count, example }]) => {
      const firstLast = example.isFirstChild
        ? " first-child"
        : example.isLastChild
          ? " last-child"
          : ""
      return `  ${count}× ${key}${firstLast} "${example.text}" @${example.x},${example.y} ${example.w}×${example.h}`
    })
    .join("\n")
}

const desktop = { width: 1280, height: 800, label: "desktop" }
const mobile = { width: 390, height: 844, label: "mobile" }

type RouteSpec = {
  name: string
  path: string
  heading?: RegExp
}

function buildRoutes(input: {
  deepSearchSlug: string
  ideaSlug: string
  debateSlug: string
  ideaId: string | null
  matchId: string | null
  roundPath: string | null
}): RouteSpec[] {
  const routes: RouteSpec[] = [
    { name: "home", path: "/" },
    { name: "about", path: "/about", heading: /About RethinkLoop/ },
    { name: "examples", path: "/examples" },
    { name: "terms", path: "/terms" },
    { name: "privacy", path: "/privacy" },
    { name: "deep-search", path: "/deep-search", heading: /Deep Search/ },
    {
      name: "deep-search-detail",
      path: `/deep-search/${input.deepSearchSlug}`,
      heading: /JavaScript Array Documentation/,
    },
    {
      name: "ideas",
      path: "/ideas",
      heading: /Generate options/,
    },
    {
      name: "ideas-detail",
      path: `/ideas/${input.ideaSlug}`,
      heading: /London Renter Energy Products/,
    },
    { name: "debates", path: "/debates", heading: /Debate ideas/ },
    {
      name: "debates-detail",
      path: `/debates/${input.debateSlug}`,
      heading: /Apartment Energy Product Ideas/,
    },
    { name: "admin-credits", path: "/admin/credits" },
    { name: "not-found", path: "/border-audit-does-not-exist" },
  ]
  if (input.roundPath !== null) {
    routes.push({ name: "deep-search-rounds", path: input.roundPath })
  }
  if (input.ideaId !== null) {
    routes.push({
      name: "ideas-idea",
      path: `/ideas/${input.ideaSlug}/${input.ideaId}`,
    })
  }
  if (input.matchId !== null) {
    routes.push({
      name: "debates-match",
      path: `/debates/${input.debateSlug}/matches/${input.matchId}`,
    })
  }
  return routes
}

async function auditRoute(
  page: Page,
  reports: Array<Record<string, unknown>>,
  name: string,
  path: string,
  viewport: { width: number; height: number; label: string },
  options?: {
    heading?: RegExp
    settleMs?: number
    beforeAudit?: () => Promise<void>
  },
): Promise<void> {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  })
  await page.goto(path)
  if (options?.heading) {
    await expect(
      page.getByRole("heading", { name: options.heading }),
    ).toBeVisible()
  } else {
    await expect(page.getByRole("main")).toBeVisible()
  }
  await options?.beforeAudit?.()
  // The audit snapshots a settled DOM after stream replay; it asserts nothing,
  // so a fixed settle is the deterministic signal here.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(options?.settleMs ?? 1_500)

  const entries = await page.evaluate(collectBorderAudit)
  const classified = classify(entries, viewport.width)
  const shotPath = join(artifactDir, `${name}--${viewport.label}.png`)
  await page.screenshot({ path: shotPath, fullPage: true })

  const report = {
    route: name,
    path,
    viewport: viewport.label,
    screenshot: shotPath,
    totals: {
      bordered: entries.filter((entry) =>
        entry.borderWidths.some((width) => width > 0),
      ).length,
      suspects: classified.suspects.length,
      masked: classified.masked.length,
      excludedDividers: classified.excludedDividers.length,
      sharedAccordionEdges: classified.sharedAccordionEdges.length,
      outlines: classified.outlines.length,
    },
    suspects: classified.suspects.map((entry) => ({
      ...entry,
      signature: signature(entry),
    })),
    masked: classified.masked.map((entry) => ({
      ...entry,
      signature: signature(entry),
    })),
    outlineExamples: classified.outlines.slice(0, 10).map((entry) => ({
      signature: signature(entry),
      text: entry.text,
      x: entry.x,
      y: entry.y,
      outlineStyle: entry.outline,
      outlineColor: entry.outlineColor,
      outlineWidth: entry.outlineWidth,
      isActive: entry.isActive,
      tag: entry.tag,
      role: entry.role,
    })),
  }
  reports.push(report)

  console.log(`\n=== ${name} @ ${viewport.label} ===`)
  console.log(
    `bordered=${report.totals.bordered} suspects=${report.totals.suspects} masked=${report.totals.masked} dividers=${report.totals.excludedDividers} accordionEdges=${report.totals.sharedAccordionEdges} outlines=${report.totals.outlines}`,
  )
  console.log("SUSPECTS:")
  console.log(summarize(classified.suspects))
  console.log("MASKED:")
  console.log(summarize(classified.masked))
}

test("border audit across routes", async ({ page, request }) => {
  test.setTimeout(480_000)

  const deepSearchSlug = await createJobAndWait(request, "deep-search", {
    researchRequest:
      "Find the official MDN documentation explaining JavaScript arrays. Generate only one search query, and make that query: !mdn JavaScript Array.",
  })
  const ideaSlug = await createJobAndWait(request, "idea", {
    prompt:
      "Generate practical product ideas to help London renters reduce household energy use in 2026.",
    numberOfIdeas: 8,
    deepSearchCount: 2,
    maxSearches: 3,
    maxResultsPerSearch: 3,
  })
  const debateSlug = await createJobAndWait(request, "debate", {
    prompt:
      "Design a practical product that helps small apartment buildings reduce energy use without installing new hardware, changing utility providers, or adding substantial work for residents or building managers.",
    numberOfIdeas: 8,
    isPublic: false,
  })

  const reports: Array<Record<string, unknown>> = []

  // Collect secondary ids from the rendered detail pages.
  await page.setViewportSize({ width: desktop.width, height: desktop.height })
  await page.goto(`/deep-search/${deepSearchSlug}`)
  await expect(
    page.getByRole("heading", { name: /JavaScript Array Documentation/ }),
  ).toBeVisible()
  // Wait for the persisted stream replay to finish rendering before reading
  // derived links from the DOM (see auditRoute settle note).
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(1_500)
  const roundPath =
    (await page
      .locator('a[href*="/rounds/"]')
      .first()
      .getAttribute("href")) ?? null

  await page.goto(`/ideas/${ideaSlug}`)
  await expect(
    page.getByRole("heading", { name: /London Renter Energy Products/ }),
  ).toBeVisible()
  // Wait for the persisted stream replay to finish rendering before reading
  // derived links from the DOM (see auditRoute settle note).
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(1_500)
  const ideaId = await page
    .locator(`a[href*="/ideas/${ideaSlug}/"]`)
    .first()
    .getAttribute("href")
    .then((href) => href?.split("/").at(-1) ?? null)

  await page.goto(`/debates/${debateSlug}`)
  await expect(
    page.getByRole("heading", { name: /Apartment Energy Product Ideas/ }),
  ).toBeVisible()
  // Wait for the persisted stream replay to finish rendering before reading
  // derived links from the DOM (see auditRoute settle note).
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(1_500)
  const matchId = await page
    .locator(`a[href*="/debates/${debateSlug}/matches/"]`)
    .first()
    .getAttribute("href")
    .then((href) => href?.split("/").at(-1) ?? null)

  const routes = buildRoutes({
    deepSearchSlug,
    ideaSlug,
    debateSlug,
    ideaId,
    matchId,
    roundPath,
  })

  for (const viewport of [desktop, mobile]) {
    for (const route of routes) {
      await auditRoute(page, reports, route.name, route.path, viewport, {
        heading: route.heading,
      })
    }
  }

  // Overlay surfaces: account menu (desktop) and mobile navigation menu.
  await auditRoute(page, reports, "about-menu-open", "/about", desktop, {
    heading: /About RethinkLoop/,
    settleMs: 300,
    beforeAudit: async () => {
      await page
        .getByRole("button", { name: "Open account menu for Debug User" })
        .click()
      await expect(page.getByRole("menu", { name: "Account menu" })).toBeVisible()
    },
  })
  await auditRoute(page, reports, "about-nav-open", "/about", mobile, {
    heading: /About RethinkLoop/,
    settleMs: 300,
    beforeAudit: async () => {
      await page.getByRole("button", { name: "Open navigation menu" }).click()
      await expect(
        page.getByRole("menu", { name: "Primary navigation links" }),
      ).toBeVisible()
    },
  })

  writeFileSync(
    join(artifactDir, "findings.json"),
    JSON.stringify(reports, null, 2),
  )
  console.log(`\nWrote ${reports.length} route reports to ${artifactDir}`)
})
