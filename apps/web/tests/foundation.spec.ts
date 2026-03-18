import { expect, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

test.describe("Foundation design system", () => {
  test("public site loads Inter font", async ({ page }) => {
    await page.goto("/");
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain("Inter");
  });

  test("public site has light tokens", async ({ page }) => {
    await page.goto("/");
    const bgBase = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim(),
    );
    expect(["#fff", "#ffffff"]).toContain(bgBase.toLowerCase());
  });

  test("console applies the console theme when the session is authenticated", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
    await page.goto("/app");
    const consoleShell = page.locator("[data-theme='console']").first();
    await expect(consoleShell).toBeVisible();
    await expect(page.locator("header.site-header-v2.is-console")).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的 AI" })).toBeVisible();

    const bgBase = await page.evaluate(() =>
      getComputedStyle(document.querySelector("[data-theme='console']") as Element).getPropertyValue("--bg-base").trim(),
    );
    expect(bgBase).toBe("#f5f0eb");
  });

  test("unauthenticated console routes redirect with locale preserved", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.goto("/en/app");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });

  test("deep-linked console login returns to the requested route", async ({ page }) => {
    await installWorkbenchApiMock(page);

    await page.goto("/en/app/knowledge");
    await expect(page).toHaveURL(/\/en\/login\?next=/);

    await page.locator("#login-email").fill("deep-link@example.com");
    await page.locator("#login-password").fill("password-1234");
    await page.locator("button[type='submit']").click();

    await expect(page).toHaveURL(/\/en\/app\/knowledge$/);
    await expect(page.locator("[data-theme='console']").first()).toBeVisible();
  });

  test("default login lands on the assistants console route", async ({ page }) => {
    await installWorkbenchApiMock(page);

    await page.goto("/login");
    await page.locator("#login-email").fill("default-login@example.com");
    await page.locator("#login-password").fill("password-1234");
    await page.locator("button[type='submit']").click();

    await expect(page).toHaveURL(/\/app\/assistants$/);
    await expect(page.getByRole("heading", { name: "我的 AI" })).toBeVisible();
  });

  test("redirects work for removed routes", async ({ page }) => {
    await page.goto("/how-it-works", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/product/);

    await page.goto("/docs", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/support/);

    await page.goto("/contact", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/support/);
  });
});

test.describe("Public site pages", () => {
  const pages = [
    { path: "/", title: "homepage" },
    { path: "/product", title: "product" },
    { path: "/ecosystem", title: "ecosystem" },
    { path: "/demo", title: "demo" },
    { path: "/pricing", title: "pricing" },
    { path: "/support", title: "support" },
    { path: "/updates", title: "updates" },
  ];

  for (const { path, title } of pages) {
    test(`${title} page loads without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      expect(errors).toEqual([]);
    });
  }
});
