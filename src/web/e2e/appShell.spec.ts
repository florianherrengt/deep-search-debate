import { expect, test } from "./fixtures.ts"

test.describe("Application shell", () => {
  test("stays dark, responsive, and keyboard accessible", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto("/about")

    await expect(page.getByRole("heading", { name: "About" })).toBeVisible()
    await expect(page.getByRole("link", { name: "About" })).toHaveAttribute(
      "aria-current",
      "page",
    )

    const darkAppearance = await page.locator("html").evaluate((element) => ({
      background: getComputedStyle(document.body).backgroundColor,
      colorScheme: getComputedStyle(element).colorScheme,
      operatingSystemPrefersLight: matchMedia(
        "(prefers-color-scheme: light)",
      ).matches,
    }))
    expect(darkAppearance).toEqual({
      background: "rgb(11, 13, 16)",
      colorScheme: "dark",
      operatingSystemPrefersLight: true,
    })

    const mobileLayout = await page.locator("body").evaluate(() => {
      const navigation = document.querySelector("nav")
      const appBar = document.querySelector(".MuiAppBar-root")
      return {
        appBarHeight: appBar?.getBoundingClientRect().height ?? Infinity,
        navigationTargetHeights:
          navigation === null
            ? []
            : Array.from(navigation.querySelectorAll("a"), (link) =>
                link.getBoundingClientRect().height,
              ),
        navigationFits:
          navigation !== null &&
          navigation.scrollWidth <= navigation.clientWidth,
        pageFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      }
    })
    expect(mobileLayout.navigationFits).toBe(true)
    expect(mobileLayout.pageFits).toBe(true)
    expect(mobileLayout.appBarHeight).toBeLessThan(90)
    expect(
      mobileLayout.navigationTargetHeights.every((height) => height >= 44),
    ).toBe(true)

    const brand = page.getByRole("link", { name: "Deep Search Debate home" })
    await page.keyboard.press("Tab")
    await expect(brand).toBeFocused()
    expect(
      await brand.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe("solid")

    const home = page.getByRole("link", { name: "Home", exact: true })
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(home).toBeFocused()
    expect(
      await home.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe("solid")

    await page.setViewportSize({ width: 800, height: 900 })
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    expect(
      await page
        .getByRole("link", { name: "About" })
        .evaluate((element) => getComputedStyle(element).textTransform),
    ).toBe("none")

    const tournamentLink = page
      .getByRole("main")
      .getByRole("link", { name: "Start a tournament" })
    await tournamentLink.scrollIntoViewIfNeeded()
    await tournamentLink.click()

    const debateHeading = page.getByRole("heading", { name: "Debate ideas" })
    await expect(debateHeading).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
