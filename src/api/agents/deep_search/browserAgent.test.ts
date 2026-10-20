import { access } from "node:fs/promises"
import puppeteer from "puppeteer"
import type { Page } from "puppeteer"
import { describe, expect, it, vi } from "vitest"
import z from "zod"

import { browserActionOutputSchema, installCaptchaHooks, recoverBrowserPage } from "./browserAgent.ts"

function makePage(challenge?: unknown, executeCaptcha = false) {
  const observation = {
    title: "Public research page",
    text: "Some useful public content.",
    elements: [
      { id: "fresh-click", kind: "button" as const, label: "Expand details", safeAction: "expand" as const },
      { id: "fresh-link", kind: "link" as const, label: "Related report", href: "https://example.org/report" },
      { id: "fresh-search", kind: "input" as const, label: "Search", safeAction: "search" as const },
    ],
    links: [{ url: "https://example.org/report", title: "Related report" }],
  }
  const locator = { click: vi.fn(), fill: vi.fn() }
  let challengeReads = 0
  let captchaApplication: { field: { value: string; dispatchEvent: ReturnType<typeof vi.fn> }; callback: ReturnType<typeof vi.fn>; namedCallback: ReturnType<typeof vi.fn> } | undefined
  const evaluate = vi.fn(async (fn: unknown, arg?: unknown) => {
    if (typeof fn === "function" && typeof arg === "number") {
      return { html: "<!DOCTYPE html><html><body>Useful evidence</body></html>" }
    }
    if (arg && typeof arg === "object" && "nonce" in arg) return observation
    if (arg && typeof arg === "object" && "token" in arg) {
      if (executeCaptcha && typeof fn === "function") {
        const field = { value: "", dispatchEvent: vi.fn() }
        const callback = vi.fn()
        const namedCallback = vi.fn()
        const widget = { querySelectorAll: () => [], closest: () => form }
        const form = { querySelectorAll: () => [field] }
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: { __rethinkLoopCaptchaCallbacks: { turnstile: [{ widgetId: "widget-1", callback }] }, siteCaptchaCallback: namedCallback },
        })
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: { querySelector: () => widget },
        })
        try { await (fn as (input: unknown) => unknown)(arg) }
        finally {
          Reflect.deleteProperty(globalThis, "window")
          Reflect.deleteProperty(globalThis, "document")
        }
        captchaApplication = { field, callback, namedCallback }
      }
      return undefined
    }
    if (typeof fn === "function" && fn.toString().includes(".cf-turnstile")) {
      challengeReads += 1
      return challengeReads === 1 ? challenge : undefined
    }
    return undefined
  })
  const page = {
    evaluate,
    locator: vi.fn(() => locator),
    content: vi.fn(() => Promise.resolve("<html><body>Useful evidence</body></html>")),
    url: vi.fn(() => "https://example.org/source"),
  }
  return { page: page as unknown as Page, locator, observation, evaluate, getCaptchaApplication: () => captchaApplication }
}

const baseParams = {
  signal: new AbortController().signal,
  userId: "user-1",
  deepSearchJobId: "job-1",
  pageId: "page-1",
  url: "https://example.org/source",
  researchRequest: "Find useful evidence.",
}

describe("recoverBrowserPage", () => {
  it("keeps the model output root an object for strict provider schemas", () => {
    const schema = z.toJSONSchema(browserActionOutputSchema)
    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
    expect(JSON.stringify(schema.properties?.next)).toContain("oneOf")
  })

  it("returns current HTML and observed links when the model extracts", async () => {
    const { page } = makePage()
    const result = await recoverBrowserPage({ ...baseParams, page }, {
      generateAction: () => Promise.resolve({ action: "extract" as const }),
    })
    expect(result).toMatchObject({
      html: "<!DOCTYPE html><html><body>Useful evidence</body></html>",
      links: [{ url: "https://example.org/report", title: "Related report" }],
      status: "extracted",
      actions: 1,
    })
  })

  it("rejects stale element IDs", async () => {
    const { page, locator } = makePage()
    await expect(recoverBrowserPage({ ...baseParams, page }, {
      generateAction: () => Promise.resolve({ action: "click" as const, elementId: "stale-id" }),
      maxActions: 12,
    })).rejects.toThrow("outside the latest page observation")
    expect(locator.click).not.toHaveBeenCalled()
  })

  it("limits model decisions to twelve and rebuilds observations after each action", async () => {
    const { page } = makePage()
    let calls = 0
    const result = await recoverBrowserPage({ ...baseParams, page }, {
      generateAction: ({ observation }) => {
        calls += 1
        expect(observation.elements[0]?.id).toBe("fresh-click")
        return Promise.resolve({ action: "scroll" as const, direction: "down" as const })
      },
      maxActions: 12,
    })
    expect(calls).toBe(12)
    expect(result).toMatchObject({ status: "action-limit", reason: "action-limit", actions: 12 })
  })

  it("does not execute model supplied URLs and hands observed links to the caller", async () => {
    const { page } = makePage()
    const generateAction = vi.fn(() => Promise.resolve({ action: "follow-link" as const, elementId: "fresh-link" }))
    const result = await recoverBrowserPage({ ...baseParams, page }, { generateAction })
    expect(generateAction).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ status: "extracted", reason: "link-handed-off" })
    expect(result.links).toContainEqual({ url: "https://example.org/report", title: "Related report" })
    expect(page.url()).toBe(baseParams.url)
  })

  it("fails closed when the model chooses an unsafe field", async () => {
    const { page, locator } = makePage()
    await expect(recoverBrowserPage({ ...baseParams, page }, {
      generateAction: () => Promise.resolve({ action: "fill" as const, elementId: "fresh-click", value: "arbitrary" }),
      maxActions: 1,
    })).rejects.toThrow("disallowed field")
    expect(locator.fill).not.toHaveBeenCalled()
  })

  it("injects a solved token into the page callback path without giving it to the model", async () => {
    const { page, evaluate, getCaptchaApplication } = makePage({ family: "turnstile", websiteKey: "site-key", widgetId: "widget-1", callbackName: "siteCaptchaCallback" }, true)
    const solve = vi.fn(() => Promise.resolve({ outcome: { status: "solved" as const, family: "turnstile" as const }, token: "secret-token" }))
    let modelObservation: unknown
    const generateAction = vi.fn((input: { observation: unknown }) => {
      modelObservation = input.observation
      return Promise.resolve({ action: "extract" as const })
    })
    const result = await recoverBrowserPage({ ...baseParams, page }, { solve, generateAction })
    expect(solve).toHaveBeenCalledOnce()
    expect(generateAction).toHaveBeenCalledOnce()
    expect(modelObservation).not.toHaveProperty("token")
    expect(evaluate.mock.calls.some(([, arg]) => Boolean(arg && typeof arg === "object" && "token" in arg && arg.token === "secret-token"))).toBe(true)
    expect(getCaptchaApplication()?.field.value).toBe("secret-token")
    expect(getCaptchaApplication()?.field.dispatchEvent).toHaveBeenCalledTimes(2)
    expect(getCaptchaApplication()?.callback).toHaveBeenCalledWith("secret-token")
    expect(getCaptchaApplication()?.namedCallback).toHaveBeenCalledWith("secret-token")
    expect(result.status).toBe("extracted")
  })

  it("reports unsupported challenge evidence without buying a task", async () => {
    const { page } = makePage("unsupported")
    const solve = vi.fn()
    const result = await recoverBrowserPage({ ...baseParams, page }, { solve })
    expect(result).toMatchObject({ status: "unsupported-captcha", reason: "unsupported-challenge" })
    expect(solve).not.toHaveBeenCalled()
  })

  it("treats a standard reCAPTCHA container and its iframe as one dynamic widget", async ({ skip }) => {
    const executablePath = await puppeteer.executablePath()
    try {
      await access(executablePath)
    } catch {
      skip()
      return
    }
    const browser = await puppeteer.launch({ headless: true })
    try {
      for (const widgetClass of ["g-recaptcha", ""]) {
        const page = await browser.newPage()
        await page.setRequestInterception(true)
        page.on("request", (request) => {
          if (request.url().startsWith("https://www.google.com/recaptcha/")) void request.abort()
          else void request.continue()
        })
        await installCaptchaHooks(page)
        const fixture = `<!doctype html><html><body>
          <p>Public evidence for research.</p>
          <form><div id="example1" class="${widgetClass}" style="width:300px;height:80px"></div>
            <textarea name="g-recaptcha-response"></textarea>
          </form><output id="callback-result"></output>
          <script>
            window.onCaptchaSolved = token => document.querySelector('#callback-result').textContent = token;
            window.grecaptcha = { render(container, options) {
              const mount = document.getElementById(container);
              const iframe = document.createElement('iframe');
              iframe.src = 'https://www.google.com/recaptcha/api2/anchor?k=' + options.sitekey;
              iframe.style.cssText = 'width:300px;height:80px';
              mount.append(iframe);
              return 'widget-id';
            } };
            window.grecaptcha.render('example1', { sitekey: 'site-key', callback: window.onCaptchaSolved });
          </script>
        </body></html>`
        await page.goto(`data:text/html,${encodeURIComponent(fixture)}`)
        // Keep the admitted research URL while the fixture itself stays local.
        Object.defineProperty(page, "url", { value: () => baseParams.url })
        let observedChallenge: unknown
        const solve = vi.fn((input: { challenge: unknown }) => {
          observedChallenge = input.challenge
          return Promise.resolve({
            outcome: { status: "solved" as const, family: "recaptcha-v2" as const },
            token: "fixture-token",
          })
        })
        const result = await recoverBrowserPage({ ...baseParams, page }, {
          solve,
          generateAction: () => Promise.resolve({ action: "extract" as const }),
        })
        expect(solve).toHaveBeenCalledOnce()
        expect(observedChallenge).toMatchObject({ family: "recaptcha-v2", websiteKey: "site-key" })
        expect(result.status).toBe("extracted")
        await expect(page.evaluate(() => ({
          field: document.querySelector<HTMLTextAreaElement>("[name=g-recaptcha-response]")?.value,
          callback: document.querySelector("#callback-result")?.textContent,
        }))).resolves.toEqual({ field: "fixture-token", callback: "fixture-token" })
        await page.close()
      }
    } finally {
      await browser.close()
    }
  })

  it("does not buy a task for a textual CAPTCHA mention without challenge evidence", async () => {
    const { page } = makePage(undefined)
    const solve = vi.fn()
    const result = await recoverBrowserPage({ ...baseParams, page }, {
      solve,
      generateAction: () => Promise.resolve({ action: "extract" as const }),
    })
    expect(solve).not.toHaveBeenCalled()
    expect(result.status).toBe("extracted")
  })
})
