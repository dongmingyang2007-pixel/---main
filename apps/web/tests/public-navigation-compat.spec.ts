import { expect, test } from "@playwright/test";

test("public routes keep above-the-fold content visible during navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /看见周围/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("link", { name: "在线体验" }).first()).toBeVisible({ timeout: 2000 });

  await page.getByRole("link", { name: "了解产品" }).first().click();
  await expect(page).toHaveURL(/\/product/);
  await expect(
    page.getByRole("heading", { name: /随身携带的 AI 感知系统/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("圆盘盒、无线耳机、胸前相机")).toBeVisible({ timeout: 2000 });

  await page.getByRole("link", { name: "在线体验" }).first().click();
  await expect(page).toHaveURL(/\/demo/);
  await expect(
    page.getByRole("heading", { name: /先试用，再决定/ }),
  ).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Latest Response")).toBeVisible({ timeout: 2000 });
});
