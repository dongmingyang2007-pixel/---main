import { test, expect } from "@playwright/test";

test.describe("Console Shell", () => {
  test("applies dark theme attributes", async ({ page }) => {
    await page.goto("/app");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "console");
    await expect(html).toHaveClass(/dark/);
  });

  test("ActivityBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".activity-bar")).toBeVisible();
  });

  test("ActivityBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".activity-bar")).not.toBeVisible();
  });

  test("TopBar renders with brand", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".topbar-brand")).toBeVisible();
  });

  test("StatusBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".statusbar")).toBeVisible();
  });

  test("StatusBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".statusbar")).not.toBeVisible();
  });

  test("Cmd+K opens command palette", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("Meta+k");
    await expect(page.locator("[role='dialog']")).toBeVisible();
  });

  test("navigation works via ActivityBar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await page.click(".activity-bar-item[aria-label='数据集']");
    await expect(page).toHaveURL(/\/app\/datasets/);
  });

  test("console pages load without errors", async ({ page }) => {
    const routes = [
      "/app",
      "/app/projects",
      "/app/datasets",
      "/app/train",
      "/app/models",
      "/app/eval",
      "/app/settings",
    ];
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
    }
  });
});
