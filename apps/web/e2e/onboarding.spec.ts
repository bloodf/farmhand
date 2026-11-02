import { expect, type Page, test } from "@playwright/test";

const ADMIN = { name: "Admin", email: "admin@example.com", password: "correct-horse-battery" };

test.describe.configure({ mode: "serial" });

/** The server is shared by the desktop and mobile projects: the first visitor sets up, later ones sign in. */
async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(setup|login)$/);
  if (page.url().endsWith("/setup")) {
    await page.getByRole("textbox", { name: /name/i }).fill(ADMIN.name);
    await page.getByRole("button", { name: /create account/i }).waitFor();
  }
  await page.getByRole("textbox", { name: /email/i }).fill(ADMIN.email);
  await page.getByRole("textbox", { name: /password/i }).fill(ADMIN.password);
  await page.getByRole("button", { name: /create account|sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("setup or login lands on the overview with the live stream up", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /overview/i })).toBeVisible();
  await expect(page.getByRole("status", { name: /live updates/i })).toContainText(/live/i, {
    timeout: 10_000,
  });
});

test("setup cannot run twice", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/(login|)$/);
});

test("add a fake printer by IP and approve it", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover?add=1");
  await page.getByRole("textbox", { name: /ip/i }).fill("127.0.0.1");
  await page.getByRole("textbox", { name: /^port/i }).fill("17126");
  await page.getByRole("button", { name: /check printer/i }).click();
  await expect(page.getByText(/snapmaker-u1/)).toBeVisible();
  await page
    .getByRole("button", { name: /^approve/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/will add|already set up/i).first()).toBeVisible();
  await dialog.getByRole("button", { name: /approve and set up/i }).click();
  await expect(dialog.getByText(/printer approved/i)).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("button", { name: /open printer/i }).click();
  await expect(page).toHaveURL(/\/printers\/[^/]+$/);
  await expect(page.getByText(/already set up|done/i).first()).toBeVisible();
});

test("no horizontal overflow and the drawer works on mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile project only");
  await signIn(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: /menu/i }).click();
  await page.getByRole("link", { name: /printers/i }).click();
  await expect(page).toHaveURL(/\/printers$/);
});
