import { expect, test } from "@playwright/test";

test("public routes keep above-the-fold content visible during navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /看见周围/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("link", { name: "在线体验" }).first()).toBeVisible({ timeout: 2000 });

  await page.goto("/product");
  await expect(page).toHaveURL(/\/product/);
  await expect(
    page.getByRole("heading", { name: /随身携带的 AI 感知系统/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("heading", { name: /三件组合，各司其职/ })).toBeVisible({ timeout: 2000 });

  await page.goto("/demo");
  await expect(page).toHaveURL(/\/demo/);
  await expect(
    page.getByRole("heading", { name: /先试用，再决定/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("button", { name: "开始推理" })).toBeVisible({ timeout: 2000 });
  await expect(page.locator("iframe.demo-iframe")).toBeVisible({ timeout: 2000 });
});
