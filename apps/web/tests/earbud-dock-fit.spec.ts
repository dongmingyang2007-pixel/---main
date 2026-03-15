import { expect, test, type Page } from "@playwright/test";
import type { ViewerWindow } from "./helpers/viewer-runtime";

const DEMO_PATH = "/demo";
const VIEWER_IFRAME = 'iframe[title="MingRun Demo Model"]';

async function getViewerFrame(page: Page) {
  const iframe = await page.$(VIEWER_IFRAME);
  if (!iframe) return null;
  return iframe.contentFrame();
}

async function waitForConnected(page: Page, timeout = 6000) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const text = document.body.innerText;
        const status = (text.match(/连接状态：(连接中|已连接|降级连接|连接超时)/) || [])[1] || "";
        const commandCount = Number((text.match(/可用命令数：(\d+)/) || [])[1] || "0");
        return { status, commandCount };
      });
    }, { timeout })
    .toEqual({ status: "已连接", commandCount: expect.any(Number) });

  await expect
    .poll(async () => {
      return page.evaluate(() => Number((document.body.innerText.match(/可用命令数：(\d+)/) || [])[1] || "0"));
    }, { timeout })
    .toBeGreaterThanOrEqual(30);
}

async function viewerGetState(page: Page): Promise<Record<string, unknown>> {
  const frame = await getViewerFrame(page);
  if (!frame) return {};
  try {
    return (
      (await frame.evaluate(() => {
        const win = window as unknown as ViewerWindow;
        return win?.QIHANG_MODEL?.getState?.() || {};
      })) as Record<string, unknown>
    );
  } catch {
    return {};
  }
}

async function viewerCommand(page: Page, name: string): Promise<void> {
  const frame = await getViewerFrame(page);
  if (!frame) return;
  await frame.evaluate((commandName) => {
    const win = window as unknown as ViewerWindow;
    win?.QIHANG_MODEL?.command?.(commandName);
  }, name);
}

test("dock-fit clearance/contact state stays in manufacturable range", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 8000);

  await expect(page.getByRole("button", { name: "左耳近景" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "右耳近景" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "入仓检视" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "耳机 X-Ray" })).toBeEnabled();

  await expect
    .poll(async () => Number((await viewerGetState(page)).earbud_fit_clearance_mm ?? 0), { timeout: 6000 })
    .toBeGreaterThanOrEqual(0.5);
  await expect
    .poll(async () => Boolean((await viewerGetState(page)).earbud_contact_engaged_l), { timeout: 6000 })
    .toBeTruthy();
  await expect
    .poll(async () => Boolean((await viewerGetState(page)).earbud_contact_engaged_r), { timeout: 6000 })
    .toBeTruthy();

  const state = await viewerGetState(page);
  expect(Number(state.earbud_fit_clearance_mm ?? 0)).toBeGreaterThanOrEqual(0.5);
  expect(Number(state.earbud_fit_clearance_mm ?? 0)).toBeLessThanOrEqual(1.0);
  expect(Boolean(state.earbud_fit_measurement_valid)).toBeTruthy();
  expect(Boolean(state.earbud_contact_engaged_l)).toBeTruthy();
  expect(Boolean(state.earbud_contact_engaged_r)).toBeTruthy();
  expect(Boolean(state.earbud_contact_measurement_valid_l)).toBeTruthy();
  expect(Boolean(state.earbud_contact_measurement_valid_r)).toBeTruthy();
  expect(Number(state.earbud_contact_compression_l_mm ?? 0)).toBeGreaterThanOrEqual(0.4);
  expect(Number(state.earbud_contact_compression_l_mm ?? 0)).toBeLessThanOrEqual(0.7);
  expect(Number(state.earbud_contact_compression_r_mm ?? 0)).toBeGreaterThanOrEqual(0.4);
  expect(Number(state.earbud_contact_compression_r_mm ?? 0)).toBeLessThanOrEqual(0.7);

  const beforeXray = Boolean(state.xrayOn);
  await viewerCommand(page, "focus-ear-left-view");
  await page.waitForTimeout(120);
  await viewerCommand(page, "focus-ear-right-view");
  await page.waitForTimeout(120);
  await viewerCommand(page, "focus-ear-dock-view");
  await page.waitForTimeout(120);
  await viewerCommand(page, "toggle-earbud-xray");
  await page.waitForTimeout(120);

  const afterState = await viewerGetState(page);
  expect(Boolean(afterState.xrayOn)).toBe(!beforeXray);
});

test("contact metrics become invalid when dock seats are unavailable", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 8000);

  const frame = await getViewerFrame(page);
  expect(frame).not.toBeNull();
  await frame?.evaluate(() => {
    const dbg = (window as unknown as ViewerWindow).__QIHANG_DEBUG;
    const baseGroup = dbg?.baseGroup;
    const seatNames = [
      "DockWell_L_ContactSeat_L",
      "DockWell_L_ContactSeat_R",
      "DockWell_R_ContactSeat_L",
      "DockWell_R_ContactSeat_R",
    ];
    for (const name of seatNames) {
      const node = baseGroup?.getObjectByName(name);
      if (node?.parent) node.parent.remove(node);
    }
  });

  await expect
    .poll(async () => Boolean((await viewerGetState(page)).earbud_contact_measurement_valid_l), { timeout: 4000 })
    .toBeFalsy();
  await expect
    .poll(async () => Boolean((await viewerGetState(page)).earbud_contact_measurement_valid_r), { timeout: 4000 })
    .toBeFalsy();

  const state = await viewerGetState(page);
  expect(Boolean(state.earbud_contact_measurement_valid_l)).toBeFalsy();
  expect(Boolean(state.earbud_contact_measurement_valid_r)).toBeFalsy();
  expect(Boolean(state.earbud_contact_engaged_l)).toBeFalsy();
  expect(Boolean(state.earbud_contact_engaged_r)).toBeFalsy();
});

test("viewer export manifest contains earbud STL set", async ({ request }) => {
  const response = await request.get("/product-viewer.html");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  for (const fileName of [
    "earbud_left_outer.stl",
    "earbud_left_inner.stl",
    "earbud_right_outer.stl",
    "earbud_right_inner.stl",
    "nozzle_grill_pair.stl",
    "dock_fit_jig.stl",
  ]) {
    expect(html).toContain(`\"${fileName}\"`);
  }

  expect(html).toContain("earbud_build_tier");
  expect(html).toContain("earbud_fit_clearance_mm");
  expect(html).toContain("earbud_fit_measurement_valid");
  expect(html).toContain("earbud_contact_engaged_l");
  expect(html).toContain("earbud_contact_engaged_r");
  expect(html).toContain("earbud_contact_measurement_valid_l");
  expect(html).toContain("earbud_spec_revision");
  expect(html).toContain("earbud_spec_source_hash");
  expect(html).toContain("earbud_module_overlap_count");
});
