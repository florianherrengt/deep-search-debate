import { expect, test } from "@playwright/test"

const hiddenSignInPath = "/8f917f11-9443-4241-b741-6320492608c5"

test("joins the waitlist from the anonymous mobile experience", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 320 })
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "One answer is not enough." }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "RethinkLoop home" }),
  ).toHaveCSS("color", "rgb(241, 243, 245)")
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toHaveCount(0)
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)

  await page
    .getByRole("main")
    .getByRole("button", { name: "Join the waiting list" })
    .first()
    .click()
  const dialog = page.getByRole("dialog", { name: "Join the waiting list" })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole("textbox", { name: "Email address" })
    .fill("Waitlist-E2E@Example.com")
  await dialog.getByRole("button", { name: "Join waiting list" }).click()
  await expect(dialog.getByText(/you’re on the waiting list/i)).toBeVisible()

  await page.goto("/debates")
  await expect(
    page.getByRole("heading", { name: "Join the waiting list" }),
  ).toBeVisible()
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("waitlist-e2e@example.com")
  await page.getByRole("button", { name: "Join waiting list" }).click()
  await expect(page.getByText(/you’re on the waiting list/i)).toBeVisible()
})

test("keeps existing authentication operational without a public sign-in button", async ({
  page,
}) => {
  await page.goto(hiddenSignInPath)
  await expect(
    page.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue as debug user" }).click()
  await expect(page).toHaveURL("/")
  await expect(
    page.getByRole("heading", { name: "One answer is not enough." }),
  ).toBeVisible()

  await page.goto("/debates")
  await expect(
    page.getByRole("heading", { name: "Debate ideas" }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Open account menu for Debug User" })
    .click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(
    page.getByRole("heading", { name: "Join the waiting list" }),
  ).toBeFocused()
})
