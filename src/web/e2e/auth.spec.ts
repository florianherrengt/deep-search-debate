import { expect, test } from "@playwright/test"

test("signs in and out with the local debug user", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 320 })
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "One answer is not enough." }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "RethinkLoop home" }),
  ).toHaveCSS("color", "rgb(241, 243, 245)")
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toHaveCount(0)
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page
    .getByRole("main")
    .getByRole("link", { name: "Start a debate" })
    .click()

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as debug user" }).click()

  const debateHeading = page.getByRole("heading", { name: "Debate ideas" })
  await expect(debateHeading).toBeVisible()
  await expect(
    page.getByRole("textbox", { name: "What should the ideas solve?" }),
  ).toBeFocused()
  await page
    .getByRole("button", { name: "Open account menu for Debug User" })
    .click()
  await expect(
    page.getByRole("menu", { name: "Account menu" }).getByText("Debug User"),
  ).toBeVisible()

  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeFocused()
})
