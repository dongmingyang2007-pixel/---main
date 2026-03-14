import { expect, test, type Page } from "@playwright/test";

const VIEWER_IFRAME = 'iframe[title="MingRun Demo Model"]';
const TARGET_REV = "20260307-tail-pivot-v37-glb-earbuds-symmetric-inspectfix";

test.use({ viewport: { width: 1536, height: 960 } });

type ViewerState = Record<string, unknown>;

async function getViewerFrame(page: Page) {
  const iframe = await page.$(VIEWER_IFRAME);
  if (!iframe) return null;
  return iframe.contentFrame();
}

async function viewerGetState(page: Page): Promise<ViewerState | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const win = window as any;
        return win?.QIHANG_MODEL?.getState?.() || null;
      });
    } catch {
      await page.waitForTimeout(80);
    }
  }
  return null;
}

async function viewerSetState(page: Page, patch: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      await frame.evaluate((statePatch) => {
        const win = window as any;
        win?.QIHANG_MODEL?.setState?.(statePatch);
      }, patch);
      return;
    } catch {
      await page.waitForTimeout(80);
    }
  }
}

async function viewerCommand(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      await frame.evaluate((commandName) => {
        const win = window as any;
        win?.QIHANG_MODEL?.command?.(commandName);
      }, name);
      return;
    } catch {
      await page.waitForTimeout(80);
    }
  }
}

async function waitForPivotState(page: Page, expected: "open" | "closed", timeout = 7000) {
  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      const pivotState = String(state?.pivot_state || "");
      const angle = Number(state?.pivot_angle_deg ?? Number.NaN);
      if (!Number.isFinite(angle)) return false;
      if (expected === "open") return pivotState === "open" && angle >= 95;
      return (pivotState === "closed" && angle <= 0.6) || angle <= 0.6;
    }, { timeout })
    .toBeTruthy();
}

async function viewerCenterOffsetMm(page: Page): Promise<number> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const dbg = (window as any).__QIHANG_DEBUG;
        const px = Number(dbg?.lidPivot?.position?.x);
        if (!Number.isFinite(px)) return Number.POSITIVE_INFINITY;
        return Math.abs(px) * 1000;
      });
    } catch {
      await page.waitForTimeout(80);
    }
  }
  return Number.POSITIVE_INFINITY;
}

async function viewerPivotHoleAxisDistanceMm(page: Page): Promise<number> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const dbg = (window as any).__QIHANG_DEBUG;
        const pin = dbg?.product?.getObjectByName?.("Pivot_Pin_Printable");
        const hole = dbg?.product?.getObjectByName?.("Lid_Pivot_Hole_Center");
        if (!pin || !hole) return Number.POSITIVE_INFINITY;
        pin.updateMatrixWorld(true);
        hole.updateMatrixWorld(true);
        const pe = pin.matrixWorld.elements as number[];
        const he = hole.matrixWorld.elements as number[];
        const dx = pe[12] - he[12];
        const dy = pe[13] - he[13];
        const dz = pe[14] - he[14];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000;
      });
    } catch {
      await page.waitForTimeout(80);
    }
  }
  return Number.POSITIVE_INFINITY;
}

test("viewer horizontal-open pivot seam/axis/dynamics regression", async ({ page }) => {
  test.setTimeout(160_000);
  await page.goto("/demo");
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();

  await expect
    .poll(async () => String((await viewerGetState(page))?.mech_revision || ""), { timeout: 45_000 })
    .toContain(TARGET_REV);

  await viewerCommand(page, "reset-view");
  await viewerSetState(page, {
    manual_pivot_override: true,
    pivot_angle_deg: 0,
    isOpen: false,
    pivot_swing_side: "left",
    xrayOn: false,
  });
  await page.waitForTimeout(1000);

  const closedState = await viewerGetState(page);
  expect(String(closedState?.pivot_opening_mode || "")).toBe("lateral_side_swing_vertical_axis");
  expect(String(closedState?.pivot_layout || "")).toBe("tail_pivot_fixed_pin_lid_keyslot_v5");
  expect(Number(closedState?.pivot_module_count ?? 0)).toBe(5);
  expect(Number(closedState?.lid_closed_seam_gap_mm ?? Number.NaN)).toBeGreaterThanOrEqual(-0.02);
  expect(Number(closedState?.lid_closed_seam_gap_mm ?? Number.NaN)).toBeLessThanOrEqual(0.09);
  expect(Number(closedState?.pivot_axis_alignment_deg ?? Number.NaN)).toBeLessThanOrEqual(5);

  for (const side of ["left", "right"] as const) {
    for (const angle of [20, 60, 96]) {
      await viewerSetState(page, {
        manual_pivot_override: true,
        pivot_angle_deg: angle,
        isOpen: angle > 0,
        pivot_swing_side: side,
      });
      await page.waitForTimeout(140);
      await expect
        .poll(async () => await viewerCenterOffsetMm(page), { timeout: 5000 })
        .toBeLessThanOrEqual(0.06);
      await expect
        .poll(async () => await viewerPivotHoleAxisDistanceMm(page), { timeout: 5000 })
        .toBeLessThanOrEqual(0.02);
    }
  }

  await viewerSetState(page, { manual_pivot_override: false, isOpen: false, pivot_swing_side: "left" });
  await waitForPivotState(page, "closed");

  for (let i = 0; i < 20; i += 1) {
    await viewerCommand(page, "open");
    await viewerSetState(page, { isOpen: true, manual_pivot_override: false });
    await waitForPivotState(page, "open");
    await viewerCommand(page, "close");
    await viewerSetState(page, { isOpen: false, manual_pivot_override: false });
    await waitForPivotState(page, "closed");
  }

  const finalState = await viewerGetState(page);
  expect(Number(finalState?.closed_lateral_jitter_mm ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.05);
  expect(Number(finalState?.pivot_spike_violation_count ?? 1)).toBe(0);
});
