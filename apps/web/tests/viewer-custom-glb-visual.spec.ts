import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { ViewerWindow } from "./helpers/viewer-runtime";

const MODEL_PATH = process.env.PLAYWRIGHT_VIEWER_MODEL || "/qihang_product_pearl_V3.glb";
const SHOT_PREFIX =
  process.env.PLAYWRIGHT_VIEWER_PREFIX || path.basename(MODEL_PATH).replace(/\.[^.]+$/, "");
const VIEWER_URL = `/product-viewer.html?model=${encodeURIComponent(MODEL_PATH)}&ui=0&note=0`;

test.use({ viewport: { width: 1400, height: 1100 } });

async function viewerGetState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const win = window as unknown as ViewerWindow;
    return win?.QIHANG_MODEL?.getState?.() || null;
  });
}

async function viewerSetState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((statePatch) => {
    const win = window as unknown as ViewerWindow;
    win?.QIHANG_MODEL?.setState?.(statePatch);
  }, patch);
}

async function viewerCommand(page: Page, name: string): Promise<void> {
  await page.evaluate((commandName) => {
    const win = window as unknown as ViewerWindow;
    win?.QIHANG_MODEL?.command?.(commandName);
  }, name);
}

async function captureCanvas(page: Page, name: string): Promise<void> {
  await page.locator("canvas").first().screenshot({
    path: test.info().outputPath(`${SHOT_PREFIX}-${name}.png`),
  });
}

test("capture custom GLB viewer screenshots", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(VIEWER_URL);

  await expect
    .poll(async () => {
      const mode = await page.evaluate(() => (window as unknown as ViewerWindow).__QIHANG_RENDER_MODE || null);
      return mode === "webgl" || mode === "headless";
    }, {
      timeout: 45_000,
    })
    .toBeTruthy();

  await expect
    .poll(async () => String((await viewerGetState(page))?.glb_visual_url || ""), {
      timeout: 45_000,
    })
    .toContain(MODEL_PATH);

  await viewerSetState(page, {
    manual_pivot_override: true,
    pivot_swing_side: "left",
    xrayOn: false,
    nightOn: false,
    exploded: false,
    autoSpin: false,
    camDetached: false,
    earbudsOut: false,
  });

  await viewerSetState(page, {
    pivot_angle_deg: 0,
    isOpen: false,
  });
  await page.waitForTimeout(250);
  await viewerCommand(page, "focus-pivot-front-view");
  await page.waitForTimeout(350);
  await captureCanvas(page, "pivot-front-closed");

  await viewerSetState(page, {
    pivot_angle_deg: 58,
    isOpen: true,
  });
  await page.waitForTimeout(250);
  await viewerCommand(page, "focus-pivot-front-view");
  await page.waitForTimeout(350);
  await captureCanvas(page, "pivot-front-open");

  await viewerCommand(page, "focus-pivot-rear-view");
  await page.waitForTimeout(350);
  await captureCanvas(page, "pivot-rear-open");

  await viewerCommand(page, "focus-pivot-rear-corner-view");
  await page.waitForTimeout(350);
  await captureCanvas(page, "pivot-rear-corner-open");
});
