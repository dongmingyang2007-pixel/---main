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

  test("console applies dark theme when the session is authenticated", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
    await page.goto("/app");
    await page.waitForSelector("html[data-theme='console']");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "console");
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    const bgBase = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim(),
    );
    expect(bgBase).toBe("#020617");
  });

  test("unauthenticated console routes redirect with locale preserved", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/en/app");
    await expect(page).toHaveURL(/\/en\/login$/);
  });

  test("redirects work for removed routes", async ({ page }) => {
    const response = await page.goto("/how-it-works");
    expect(response?.url()).toContain("/product");

    const response2 = await page.goto("/docs");
    expect(response2?.url()).toContain("/support");

    const response3 = await page.goto("/contact");
    expect(response3?.url()).toContain("/support");
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
