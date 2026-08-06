import { expect, test } from "@playwright/test"

test("signs in and out with the local debug user", async ({ page }) => {
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as debug user" }).click()

  await expect(
    page.getByRole("heading", { name: "Research, generate, and decide" }),
  ).toBeVisible()
  await expect(page.getByText("Debug User")).toBeVisible()

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
})
