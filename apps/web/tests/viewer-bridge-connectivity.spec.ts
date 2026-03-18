import { expect, test, type Page } from "@playwright/test";
import {
  expectDemoViewerVisible,
  openDemoAdvancedControls,
  readDemoBridgeSnapshot,
  waitForDemoConnected,
} from "./helpers/demo-viewer";

const DEMO_PATH = "/demo";

async function readBridgeSnapshot(page: Page) {
  return readDemoBridgeSnapshot(page);
}

test("demo bridge connects within 3 seconds and exposes commands", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 3000);
});

test("demo bridge reconnects reliably across 10 refreshes", async ({ page }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < 10; i += 1) {
    await page.goto(DEMO_PATH);
    await expectDemoViewerVisible(page);
    await waitForDemoConnected(page, 6000);
  }
});

test("task switch during connecting still unlocks command controls", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await page.getByRole("button", { name: "文字识别" }).click();
  await waitForDemoConnected(page, 4000);
  await openDemoAdvancedControls(page);
  await expect(page.getByRole("button", { name: /打开盒盖|合上盒盖/ }).first()).toBeEnabled();
});

test("forged qihang-viewer messages from non-iframe source are ignored", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 4000);

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
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 5000);
  await openDemoAdvancedControls(page);
  await expect(page.getByRole("button", { name: /打开盒盖|合上盒盖/ }).first()).toBeEnabled();
});
