---
name: visual-ui-inspection
description: Inspect and verify rendered web interfaces with Playwright MCP accessibility refs and screenshots during frontend development or review. Use when visual evidence is needed; do not use for semantic web research or non-browser artifacts.
---

# Visual UI inspection

Use Playwright MCP as the browser and screenshot authority. Do not create a parallel screenshot script or infer rendered behavior from source code alone.

## Inspect progressively

1. Start or reuse the repository's development servers and navigate to the relevant UI state.
2. Capture the visible context with `browser_take_screenshot({ scale: "css" })`.
3. Bind the rendered UI to temporary refs with `browser_snapshot({ boxes: true })`. When the page is large and the intended text is known, use `browser_find` or a targeted, depth-limited snapshot instead of returning an unnecessarily large tree.
4. Identify the smallest meaningful component container, such as the panel or `div` that owns the visual issue, and capture it with `browser_take_screenshot({ element: "<short description>", target: "<ref>", scale: "device" })`.
5. After editing, reproduce the same state, capture a fresh snapshot, and compare a new element close-up with the surrounding viewport.

Use `browser_take_screenshot({ fullPage: true, scale: "css" })` only when global layout or long-page structure genuinely requires the entire scrollable page. Do not use full-page capture as the default or request device-scale full-page images gratuitously.

## Refs and visual detail

- Treat snapshot refs as temporary bindings to the current rendered page. Re-inspect after navigation, reload, rerender, or state changes that may replace elements.
- If a ref is stale or missing, capture a new snapshot and use its new ref. Do not fall back to a guessed CSS selector.
- Prefer an element-ref screenshot over an arbitrary coordinate crop. If the exact visual area is not independently represented, screenshot the nearest meaningful container.
- Use `scale: "css"` for context and `scale: "device"` for component detail. Preserve native detail, accept a native 1x source when that is what the browser provides, and never upscale an image to manufacture detail.
- Snapshot boxes map refs to viewport-relative CSS coordinates when that context helps. Do not inject page overlays merely to annotate a screenshot.

## Verification evidence

Capture before and after evidence at the same relevant viewport and UI state. Verify the changed component closely, then verify its surrounding layout for regressions. Base development and review conclusions on the rendered evidence, and include the useful screenshots in the final response when the user asks to see them.
