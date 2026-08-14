import { expect, test } from "./fixtures.ts"

test.describe("Application shell", () => {
  test("keeps the signed-in home inside a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto("/")

    await expect(
      page.getByRole("heading", { name: "One answer is not enough." }),
    ).toBeVisible()
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
  })

  test("stays dark, responsive, and keyboard accessible", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto("/about")

    await expect(
      page.getByRole("heading", { name: "About RethinkLoop" }),
    ).toBeVisible()

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
            : Array.from(
                navigation.querySelectorAll("a, button"),
                (control) => control.getBoundingClientRect().height,
              ).filter((height) => height > 0),
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

    const creditBalance = page.getByRole("status", {
      name: /^Credit balance: .* credits$/,
    })
    await expect(creditBalance).toBeVisible()
    const visibleCreditLabels = await creditBalance.locator("span").evaluateAll(
      (elements) =>
        elements
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => element.textContent?.trim() ?? ""),
    )
    expect(visibleCreditLabels.some((label) => /\scr$/.test(label))).toBe(true)

    const brand = page.getByRole("link", { name: "RethinkLoop home" })
    await expect(brand).toHaveCSS("color", "rgb(241, 243, 245)")
    await page.keyboard.press("Tab")
    await expect(brand).toBeFocused()
    expect(
      await brand.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe("solid")

    const home = page.getByRole("menuitem", { name: "Home", exact: true })
    await page.keyboard.press("Tab")
    await expect(
      page.getByRole("button", { name: "Open navigation menu" }),
    ).toBeFocused()
    await page.keyboard.press("Tab")
    const accountButton = page.getByRole("button", {
      name: "Open account menu for Debug User",
    })
    await expect(accountButton).toBeFocused()

    await page.keyboard.press("Enter")
    const accountMenu = page.getByRole("menu", { name: "Account menu" })
    await expect(accountMenu.getByText("Debug User")).toBeVisible()
    await expect(
      accountMenu.getByRole("menuitem", { name: "About" }),
    ).toHaveAttribute("aria-current", "page")
    await expect(
      accountMenu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible()
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Open navigation menu" }).click()
    const mobileNavigation = page.getByRole("menu", {
      name: "Primary navigation links",
    })
    await expect(
      mobileNavigation.getByRole("menuitem", { name: "Home" }),
    ).toBeVisible()
    await expect(
      mobileNavigation.getByRole("menuitem", { name: "Research a question" }),
    ).toBeVisible()
    await expect(
      mobileNavigation.getByRole("menuitem", { name: "Generate options" }),
    ).toBeVisible()
    await expect(
      mobileNavigation.getByRole("menuitem", { name: "Compare options" }),
    ).toBeVisible()
    await page.keyboard.press("Escape")

    await accountButton.focus()
    await page.keyboard.press("Shift+Tab")
    await expect(
      page.getByRole("button", { name: "Open navigation menu" }),
    ).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(brand).toBeFocused()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await expect(home).toBeFocused()
    expect(
      await home.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe("solid")
    await page.keyboard.press("Escape")

    await page.setViewportSize({ width: 900, height: 900 })
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    expect(
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: "Research a question", exact: true })
        .evaluate((element) => getComputedStyle(element).textTransform),
    ).toBe("none")
    await expect(accountButton).toContainText("Debug User")

    const debateLink = page
      .getByRole("main")
      .getByRole("link", { name: "Start a debate" })
    await debateLink.scrollIntoViewIfNeeded()
    await debateLink.click()

    const debateHeading = page.getByRole("heading", { name: "Debate ideas" })
    await expect(debateHeading).toBeFocused()
    expect(
      await debateHeading.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).toBe("none")
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test("closes shell menus during browser history navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto("/about")
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Research a question", exact: true })
      .click()
    await expect(page).toHaveURL(/\/deep-search$/)

    await page
      .getByRole("button", { name: "Open account menu for Debug User" })
      .click()
    await expect(
      page.getByRole("menu", { name: "Account menu" }),
    ).toBeVisible()

    await page.goBack()

    await expect(page).toHaveURL(/\/about$/)
    await expect(
      page.getByRole("menu", { name: "Account menu" }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "About RethinkLoop" }),
    ).toBeFocused()

    await page.setViewportSize({ width: 320, height: 844 })
    await page.getByRole("button", { name: "Open navigation menu" }).click()
    await expect(
      page.getByRole("menu", { name: "Primary navigation links" }),
    ).toBeVisible()

    await page.goForward()

    await expect(page).toHaveURL(/\/deep-search$/)
    await expect(
      page.getByRole("menu", { name: "Primary navigation links" }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("heading", { name: "Deep Search" }),
    ).toBeFocused()
  })
})
