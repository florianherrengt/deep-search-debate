---
id: 12
title: Square screenshot of generated winner website replaces visit button
status: in-progress
priority: medium
created: 2026-08-24T02:06:11.7716+01:00
updated: 2026-08-24T02:42:27.113181+01:00
started: 2026-08-24T02:06:20.878187+01:00
tags:
    - feature
claimed_by: ox-alpha
claimed_at: 2026-08-24T02:42:27.113286+01:00
class: standard
---

When an idea website has been generated (debate tournament winner), render the stored single-file HTML headlessly (Puppeteer) and capture a square screenshot next to it under IDEA_SITES_DIR/<idea_uuid>/websites/. Serve it through the existing idea website read scope and replace the 'Open the generated website' text link in WinnerIdeaCard with the clickable square screenshot. Capture is best-effort: a screenshot failure must never fail the debate run; UI falls back to the current text link.

Implemented on branch feat/12-winner-site-screenshot. API: puppeteer captures a 1024x1024 PNG of the stored site file to IDEA_SITES_DIR/<idea>/websites/screenshot.png right after write (lazy import, best-effort warn on failure); GET .../website/screenshot.png serves it under the website read scope; debate snapshot exposes derived winnerWebsiteHasScreenshot. Web: WinnerIdeaCard renders the clickable square preview when present, text-link fallback otherwise. Dockerfile installs Debian chromium + PUPPETEER_EXECUTABLE_PATH, build/dagger skip Chrome download. Verified: gatekeep green (559 api + 281 web), real-Chrome capture proof, and debates E2E asserting the visible preview.
