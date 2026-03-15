import { expect, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

test.describe("Console Shell", () => {
  test.beforeEach(async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
  });

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
    await expect(page.locator(".topbar-brand")).toContainText("铭润科技");
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
    await expect(page.getByPlaceholder("输入命令或搜索...")).toBeVisible();
  });

  test("navigation works via ActivityBar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await page.click(".activity-bar-item[aria-label='数据集']");
    await expect(page).toHaveURL(/\/app\/datasets$/);
    await expect(page.getByRole("heading", { name: "数据集", exact: true }).first()).toBeVisible();
  });

  test("english console shell also renders correctly", async ({ page }) => {
    await page.goto("/en/app");
    await expect(page.locator(".topbar-brand")).toContainText("Mingrun Tech");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
