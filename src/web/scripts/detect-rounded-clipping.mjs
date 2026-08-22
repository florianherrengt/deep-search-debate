#!/usr/bin/env node
/**
 * Detect text clipped by oversized rounded corners.
 *
 * A container with `border-radius` and clipping overflow (hidden/auto/scroll)
 * clips every descendant to its rounded box. If the radius is large — e.g. a
 * themed radius that resolves to 100px instead of the intended 10px — text
 * near the four corners is partially or fully swallowed without any error.
 * This script scans a rendered page for that defect class.
 *
 * It is purely geometric: it reads computed styles and text-layout boxes from
 * the live DOM and computes how much of each text box falls inside a corner
 * cut-out (the box region beyond each corner circle) of every rounded
 * clipping ancestor. No screenshots or pixel thresholds are involved, so it
 * is deterministic and fast.
 *
 * Usage (from src/web, with storybook-static served, or any page URL):
 *   node scripts/detect-rounded-clipping.mjs <url> [--all] [--threshold 0.1]
 *
 *   <url>        Page to scan (e.g. a Storybook iframe.html?id=... URL).
 *   --all        Instead of <url>, sweep every story listed in
 *                storybook-static/index.json (serve that directory).
 *   --threshold  Minimum fraction of a text box that must fall inside a
 *                corner cut-out to be reported. Default 0.1.
 *
 * Exit code 1 when any text box is clipped, 0 otherwise.
 */
import { readFile } from "node:fs/promises"
import { chromium } from "@playwright/test"

const args = process.argv.slice(2)
const thresholdFlag = args.indexOf("--threshold")
const THRESHOLD = thresholdFlag >= 0 ? Number(args[thresholdFlag + 1]) : 0.1
const baseFlag = args.indexOf("--base")
const BASE = baseFlag >= 0 ? args[baseFlag + 1] : "http://127.0.0.1:8123"
const allMode = args.includes("--all")
const urlArg = allMode ? null : args.find((a) => a.startsWith("http"))

if (!allMode && !urlArg) {
  console.error("usage: node detect-rounded-clipping.mjs <url> [--all] [--threshold 0.1]")
  process.exit(2)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const targets = allMode
  ? Object.values(JSON.parse(await readFile("storybook-static/index.json", "utf8")).entries)
  : [{ id: "single", iframeUrl: urlArg }]

const findings = []
let scannedStories = 0

for (const entry of targets) {
  const iframeUrl = allMode ? `${BASE}/iframe.html?id=${entry.id}` : entry.iframeUrl
  let storyFindings
  try {
    await page.goto(iframeUrl, { waitUntil: "networkidle", timeout: 30_000 })
    await page.waitForTimeout(600)
    storyFindings = await page.evaluate((threshold) => {
      /** Parse a computed border-radius into per-corner {rx, ry} radii in px. */
      function parseRadii(computed, width, height) {
        const [h, v] = computed.split("/").map((part) => part.trim().split(/\s+/))
        const expand = (list) => {
          if (list.length === 1) return [list[0], list[0], list[0], list[0]]
          if (list.length === 2) return [list[0], list[1], list[0], list[1]]
          if (list.length === 3) return [list[0], list[1], list[2], list[1]]
          return list
        }
        const toPx = (value, basis) => {
          if (value.endsWith("%")) return (parseFloat(value) / 100) * basis
          return parseFloat(value) || 0
        }
        const hx = expand(h ?? ["0"])
        const vx = expand(v ?? h ?? ["0"])
        const order = [0, 1, 3, 2] // tl, tr, br, bl
        return order.map((i) => ({
          rx: toPx(hx[i], width),
          ry: toPx(vx[i], height),
        }))
      }

      const out = []
      const containers = []

      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden") continue
        const overflow = `${cs.overflowX} ${cs.overflowY}`
        if (!/(hidden|auto|scroll|clip)/.test(overflow)) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 4 || rect.height < 4) continue
        const radii = parseRadii(cs.borderRadius, rect.width, rect.height)
        if (!radii.some((r) => r.rx > 0.5 && r.ry > 0.5)) continue

        containers.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 80),
          radius: cs.borderRadius,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        })

        // Walk descendant text nodes with non-empty rendered text.
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const checked = new Set()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue
          if (checked.has(node.parentElement)) continue
          checked.add(node.parentElement)
          const parent = node.parentElement
          const pcs = getComputedStyle(parent)
          if (pcs.display === "none" || pcs.visibility === "hidden") continue
          const range = document.createRange()
          range.selectNodeContents(parent)
          const text = range.getBoundingClientRect()
          if (text.width < 6 || text.height < 4) continue
          if (
            text.right < rect.left ||
            text.left > rect.right ||
            text.bottom < rect.top ||
            text.top > rect.bottom
          ) {
            continue
          }

          // Sample the text box. A point inside the container box is clipped
          // when it falls in a corner quadrant (beyond the corner circle
          // center) and outside that corner's circle — the rounded-rect
          // corner cut-out.
          const step = Math.max(1, Math.min(text.width, text.height) / 24)
          let total = 0
          let clipped = 0
          for (let y = text.top + step / 2; y < text.bottom; y += step) {
            for (let x = text.left + step / 2; x < text.right; x += step) {
              total++
              if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                continue
              }
              const cut = [0, 1, 2, 3].some((i) => {
                const r = radii[i]
                const cx = i === 0 || i === 3 ? rect.left + r.rx : rect.right - r.rx
                const cy = i === 0 || i === 1 ? rect.top + r.ry : rect.bottom - r.ry
                const inQuadrant =
                  (i === 0 || i === 3 ? x <= cx : x >= cx) &&
                  (i === 0 || i === 1 ? y <= cy : y >= cy)
                if (!inQuadrant) return false
                const nx = (x - cx) / r.rx
                const ny = (y - cy) / r.ry
                return nx * nx + ny * ny > 1
              })
              if (cut) clipped++
            }
          }
          if (total > 0 && clipped / total >= threshold) {
            out.push({
              text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 60),
              fractionClipped: clipped / total,
              textRect: {
                x: text.x,
                y: text.y,
                w: text.width,
                h: text.height,
              },
            })
          }
        }
      }
      return { containers, findings: out }
    }, THRESHOLD)
  } catch (error) {
    console.error(`[skip] ${entry.id}: ${error.message.split("\n")[0]}`)
    continue
  }

  scannedStories++
  const label = allMode ? `${entry.id}` : urlArg
  for (const c of storyFindings.containers) {
    console.log(`[scan] ${label} — rounded+clipping container ${c.tag}.${c.cls} radius=${c.radius}`)
  }
  for (const f of storyFindings.findings) {
    findings.push({ story: label, ...f })
    console.log(
      `[CLIP] ${label} — "${f.text}" ${(f.fractionClipped * 100).toFixed(0)}% of text box in a rounded-corner cut-out`,
    )
  }
}

await browser.close()

console.log(`\nScanned ${scannedStories} story/stories; ${findings.length} clipped text finding(s).`)
for (const f of findings) {
  console.log(`  - ${f.story}: "${f.text}" (${(f.fractionClipped * 100).toFixed(0)}% clipped)`)
}
process.exit(findings.length > 0 ? 1 : 0)