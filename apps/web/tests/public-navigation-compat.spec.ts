import { expect, test } from "@playwright/test";

test("public routes keep above-the-fold content visible during navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /让环境 AI 先像产品，再像日常存在/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("link", { name: "进入 Demo" }).first()).toBeVisible({ timeout: 2000 });

  await page.getByRole("link", { name: "查看产品页" }).first().click();
  await expect(page).toHaveURL(/\/product/);
  await expect(
    page.getByRole("heading", { name: /先把硬件摆上舞台，再讲它能做什么/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("产品页先让人看到一个真实对象")).toBeVisible({ timeout: 2000 });

  await page.getByRole("link", { name: "进入 Demo" }).first().click();
  await expect(page).toHaveURL(/\/demo/);
  await expect(
    page.getByRole("heading", { name: /在主舞台里直接试一次设备、隐私和推理闭环/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Latest Response")).toBeVisible({ timeout: 2000 });
});
