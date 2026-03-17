import { expect, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

test.describe("Console Shell", () => {
  test.beforeEach(async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
  });

  test("applies console theme attributes", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("[data-theme='console']").first()).toBeVisible();
    await expect(page.locator("header.site-header-v2.is-console")).toBeVisible();
  });

  test("IconBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".icon-bar")).toBeVisible();
  });

  test("IconBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".icon-bar")).not.toBeVisible();
  });

  test("inline top bar renders with breadcrumbs", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".inline-topbar")).toBeVisible();
    await expect(page.locator(".inline-topbar-breadcrumb")).toContainText("仪表盘");
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
    await expect(page.getByPlaceholder("输入命令或搜索…")).toBeVisible();
  });

  test("navigation works via IconBar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await page.click(".icon-bar-item[aria-label='知识库']");
    await expect(page).toHaveURL(/\/app\/knowledge$/);
    await expect(page.locator("#knowledge-name")).toBeVisible();
  });

  test("english console shell also renders correctly", async ({ page }) => {
    await page.goto("/en/app");
    await expect(page.locator("header.site-header-v2.is-console")).toContainText("Mingrun Tech");
    await expect(page.getByRole("heading", { name: "My AI" })).toBeVisible();
  });
});
