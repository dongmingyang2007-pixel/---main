import { expect, Page, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

async function fillRegisterForm(page: Page, localePrefix: "" | "/en", stamp: string) {
  await page.goto(`${localePrefix}/register`);
  await page.locator("#register-display-name").fill(`User ${stamp}`);
  await page.locator("#register-email").fill(`user-${stamp}@example.com`);
  await page.locator("#register-password").fill("password-1234");
  await page.locator("#register-confirm-password").fill("password-1234");
}

test("public pages smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("一枚随身佩戴的 AI 设备", { exact: false })).toBeVisible();

  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "视觉问答" })).toBeVisible();
});

test("english register flow uses two-step verification and enters the english console", async ({ page }) => {
  await installWorkbenchApiMock(page);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await fillRegisterForm(page, "/en", stamp);
  await page.getByRole("button", { name: "Get verification code" }).click();

  await expect(page.getByRole("heading", { name: "Enter verification code" })).toBeVisible();
  await page.locator("#register-code").fill("654321");
  await page.getByRole("button", { name: "Register and enter console" }).click();

  await expect(page).toHaveURL(/\/en\/app\/assistants$/);
  await expect(page.getByRole("heading", { name: "My AI" })).toBeVisible();
  await expect(page.locator("[data-theme='console']").first()).toBeVisible();
});

test("chinese forgot-password flow uses verification code and shows success state", async ({ page }) => {
  await installWorkbenchApiMock(page);

  await page.goto("/forgot-password");
  await page.locator("#reset-email").fill("reset@example.com");
  await page.getByRole("button", { name: "获取验证码" }).click();

  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await page.locator("#reset-code").fill("123456");
  await page.locator("#reset-password").fill("new-password-1234");
  await page.getByRole("button", { name: "确认重设" }).click();

  await expect(page.getByRole("heading", { name: "密码已更新" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去登录" }).or(page.getByRole("button", { name: "去登录" }))).toBeVisible();
});

test("console pages load correctly against mocked API", async ({ page }) => {
  await installWorkbenchApiMock(page, { authenticated: true });

  // Assistants page loads and shows the seed project as an assistant card
  await page.goto("/app/assistants");
  await expect(page.getByRole("heading", { name: "我的 AI", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Seed Console Project/i }).first()).toBeVisible();

  // Knowledge page loads and shows the create form
  await page.goto("/app/knowledge");
  await expect(page.getByRole("heading", { name: "知识库", exact: true })).toBeVisible();

  // Create a dataset via the knowledge form
  const stamp = `${Date.now()}`;
  const datasetName = `知识包-${stamp}`;
  await page.locator("#knowledge-name").fill(datasetName);
  await page.getByRole("button", { name: "新建知识包" }).click();
  await expect(page.getByText(datasetName)).toBeVisible();

  // Training page loads and shows job list
  await page.goto("/app/training");
  await expect(page.getByRole("heading", { name: "训练中心", exact: true })).toBeVisible();
  await expect(page.getByText(/job-seed/i)).toBeVisible();
});
