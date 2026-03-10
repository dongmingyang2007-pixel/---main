import { expect, Page, test } from "@playwright/test";

async function registerAndEnterApp(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `${prefix}-${stamp}@example.com`;
  await page.goto("/register");
  await page.getByPlaceholder("显示名").fill(`User ${stamp}`);
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill("pass1234");
  await page.getByRole("button", { name: "注册并进入控制台" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

test("public pages smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /环境 AI 工作台/ })).toBeVisible();

  await page.goto("/demo");
  await expect(page.getByText("任务与推理")).toBeVisible();
});

test("auth redirect and register", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await registerAndEnterApp(page, "redirect");
  await expect(page.getByText("Control Console")).toBeVisible();
});

test("app core flow smoke", async ({ page }) => {
  await registerAndEnterApp(page, "flow");

  await page.goto("/app/projects");
  const projectName = `项目-${Date.now()}`;
  await page.getByPlaceholder("项目名").fill(projectName);
  await page.getByPlaceholder("描述").fill("playwright");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByText(projectName)).toBeVisible();

  await page.goto("/app/datasets");
  const datasetName = `数据集-${Date.now()}`;
  await page.getByPlaceholder("数据集名").fill(datasetName);
  await page.getByRole("button", { name: "新建数据集" }).click();
  await expect(page.getByText(datasetName)).toBeVisible();

  await page.getByRole("link", { name: "样本浏览" }).first().click();
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(page.getByText("已提交版本")).toBeVisible();

  await page.goto("/app/train");
  await expect(page.getByRole("button", { name: "创建训练任务" })).toBeVisible();
  await page.getByRole("button", { name: "创建训练任务" }).click();
  await expect(page.locator("text=Recipe")).toBeVisible();

  await page.goto("/app/models");
  const modelName = `模型-${Date.now()}`;
  await page.getByPlaceholder("模型名").fill(modelName);
  await page.getByRole("button", { name: "新建模型" }).click();
  await page.getByRole("link", { name: "详情" }).first().click();
  await expect(page.getByText("Alias 管理（发布/回滚）")).toBeVisible();
});
