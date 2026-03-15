import { expect, Page, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

async function fillRegisterForm(page: Page, localePrefix: "" | "/en", stamp: string) {
  await page.goto(`${localePrefix}/register`);
  await page.locator("#register-display-name").fill(`User ${stamp}`);
  await page.locator("#register-email").fill(`user-${stamp}@example.com`);
  await page.locator("#register-password").fill("password-1234");
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

  await expect(page).toHaveURL(/\/en\/app$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "console");
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
  await expect(page.getByRole("link", { name: "去登录" })).toBeVisible();
});

test("console top-level create flows work against mocked API", async ({ page }) => {
  await installWorkbenchApiMock(page, { authenticated: true });

  const stamp = `${Date.now()}`;
  const projectName = `项目-${stamp}`;
  const datasetName = `数据集-${stamp}`;
  const modelName = `模型-${stamp}`;

  await page.goto("/app/projects");
  await page.getByLabel("项目名").fill(projectName);
  await page.getByLabel("描述").fill("playwright mock");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByText(projectName)).toBeVisible();

  await page.goto("/app/datasets");
  await page.getByLabel("数据集名").fill(datasetName);
  await page.getByRole("button", { name: "新建数据集" }).click();
  await expect(page.getByText(datasetName)).toBeVisible();

  await page.goto("/app/train");
  await page.getByRole("button", { name: "创建训练任务" }).click();
  await expect(page.getByText(/job-|job-seed/i)).toBeVisible();

  await page.goto("/app/models");
  await page.getByLabel("模型名").fill(modelName);
  await page.getByRole("button", { name: "新建模型" }).click();
  await expect(page.getByText(modelName)).toBeVisible();
});
