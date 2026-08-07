import { expect, test } from "@playwright/test"

test("signs in and out with the local debug user", async ({ page }) => {
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "One answer is not enough." }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Deep Search Debate home" }),
  ).toHaveCSS("color", "rgb(241, 243, 245)")
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toHaveCount(0)
  await page
    .getByRole("main")
    .getByRole("link", { name: "Start a debate" })
    .click()

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as debug user" }).click()

  await expect(page.getByRole("heading", { name: "Debate ideas" })).toBeVisible()
  await expect(page.getByText("Debug User")).toBeVisible()

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
})
