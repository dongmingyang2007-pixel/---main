import { expect, test, type Page } from "@playwright/test";

const DEMO_PATH = "/demo";
const VIEWER_IFRAME = 'iframe[title="QIHANG Demo Model"]';

async function readBridgeSnapshot(page: Page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const status = (text.match(/连接状态：(连接中|已连接|降级连接|连接超时)/) || [])[1] || "";
    const commandCount = Number((text.match(/可用命令数：(\d+)/) || [])[1] || "0");
    return { status, commandCount, text };
  });
}

async function waitForConnected(page: Page, timeout = 3000) {
  await expect
    .poll(async () => {
      const snap = await readBridgeSnapshot(page);
      return snap.status === "已连接" && snap.commandCount > 0;
    }, { timeout })
    .toBeTruthy();
}

test("demo bridge connects within 3 seconds and exposes commands", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 3000);
});

test("demo bridge reconnects reliably across 10 refreshes", async ({ page }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < 10; i += 1) {
    await page.goto(DEMO_PATH);
    await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
    await waitForConnected(page, 4000);
  }
});

test("task switch during connecting still unlocks command controls", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await page.getByRole("button", { name: "任务 OCR" }).click();
  await waitForConnected(page, 4000);
  await expect(page.getByRole("button", { name: /盒盖/ }).first()).toBeEnabled();
});

test("forged qihang-viewer messages from non-iframe source are ignored", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 4000);

  const before = await readBridgeSnapshot(page);

  await page.evaluate(() => {
    window.postMessage(
      {
        source: "qihang-viewer",
        type: "qihang:model:state",
        payload: { status_text: "FORGED_STATE_TEXT_SHOULD_NOT_APPLY" },
      },
      window.location.origin,
    );
    window.postMessage(
      {
        source: "qihang-viewer",
        type: "qihang:model:ready",
        payload: { commands: [] },
      },
      window.location.origin,
    );
  });

  await page.waitForTimeout(300);
  const after = await readBridgeSnapshot(page);

  expect(after.text).not.toContain("FORGED_STATE_TEXT_SHOULD_NOT_APPLY");
  expect(after.commandCount).toBeGreaterThanOrEqual(before.commandCount);
});

test("bridge stays usable when static GLB assets fail and viewer falls back", async ({ page }) => {
  await page.route("**/product-assets/*.glb", (route) => route.abort());
  await page.route("**/product.glb", (route) => route.abort());

  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 5000);
  await expect(page.getByRole("button", { name: /盒盖/ }).first()).toBeEnabled();
});
