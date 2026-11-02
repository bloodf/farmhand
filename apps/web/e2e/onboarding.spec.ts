import { expect, test } from "@playwright/test";

const ADMIN = { name: "Admin", email: "admin@example.com", password: "correct-horse-battery" };

test.describe.configure({ mode: "serial" });

test("first run creates the admin and lands on the overview", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("textbox", { name: /name/i }).fill(ADMIN.name);
  await page.getByRole("textbox", { name: /email/i }).fill(ADMIN.email);
  await page.getByRole("textbox", { name: /password/i }).fill(ADMIN.password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /overview/i })).toBeVisible();
  await expect(page.getByRole("status", { name: /live updates/i })).toContainText(/live/i);
});

test("second visit goes to login and signs in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("textbox", { name: /email/i }).fill(ADMIN.email);
  await page.getByRole("textbox", { name: /password/i }).fill(ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("no horizontal overflow and the drawer works on mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile project only");
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(ADMIN.email);
  await page.getByRole("textbox", { name: /password/i }).fill(ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: /menu/i }).click();
  await page.getByRole("link", { name: /printers/i }).click();
  await expect(page).toHaveURL(/\/printers$/);
});
