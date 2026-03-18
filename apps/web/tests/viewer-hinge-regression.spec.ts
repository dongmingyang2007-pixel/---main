import { expect, test, type Page } from "@playwright/test";
import type {
  ViewerObject3D,
  ViewerWindow,
} from "./helpers/viewer-runtime";
import {
  DEMO_VIEWER_IFRAME as VIEWER_IFRAME,
  demoViewerCommand,
  demoViewerGetState,
  demoViewerSetState,
  expectDemoViewerVisible,
  getDemoViewerFrame,
} from "./helpers/demo-viewer";

const TARGET_REV = "20260308-tail-pivot-v51-device-scale";

test.use({ viewport: { width: 1536, height: 960 } });

type ViewerState = {
  pivot_angle_deg?: number;
  pivot_state?: string;
  pivot_open_elapsed_ms?: number;
  pivot_path_safe_open_deg?: number;
  pivot_path_min_clearance_mm?: number;
  pivot_shell_min_clearance_mm?: number;
  pivot_rear_corner_min_clearance_mm?: number;
  pivot_clearance_sample_step_deg?: number;
  pivot_clearance_sample_count?: number;
  closed_lateral_jitter_mm?: number;
  pivot_notch_peak_over_cap_mm?: number;
  pivot_spike_violation_count?: number;
  pivot_clip_guard_active?: boolean;
  pivot_axis_count?: number;
  pivot_layout?: string;
  pivot_inspect_active?: boolean;
  pivot_explode_active?: boolean;
  pivot_module_count?: number;
  pivot_inspect_min_clearance_mm?: number;
  pivot_swing_side?: string;
  mech_revision?: string;
};

async function viewerGetState(page: Page): Promise<ViewerState | null> {
  const state = await demoViewerGetState(page);
  return Object.keys(state).length ? (state as ViewerState) : null;
}

async function viewerSetState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await demoViewerSetState(page, patch);
}

async function viewerCommand(page: Page, name: string): Promise<void> {
  await demoViewerCommand(page, name);
}

type PivotVisualSnapshot = {
  visibleCoreCount: number;
  probeVisibleCount: number;
  centerOffsetMm: number;
};

type PivotPinWorldSnapshot = {
  position: [number, number, number];
  rotation3x3: [number, number, number, number, number, number, number, number, number];
  legacyVisiblePinPartCount: number;
};

async function viewerPivotHoleAxisDistanceMm(page: Page): Promise<number> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getDemoViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const dbg = (window as unknown as ViewerWindow).__QIHANG_DEBUG;
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

async function viewerPivotVisualSnapshot(page: Page): Promise<PivotVisualSnapshot | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getDemoViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const win = window as unknown as ViewerWindow;
        const dbg = win?.__QIHANG_DEBUG;
        if (!dbg?.product || !dbg?.baseShell || !dbg?.lidShell) return null;
        const coreNames = [
          "Lid_Pivot_Ear_Center",
          "Pivot_Pin_Printable",
          "Base_Pivot_Stop_Face",
          "Lid_Pivot_Stop_Face",
        ];
        let visibleCoreCount = 0;
        for (const name of coreNames) {
          const node = dbg.product.getObjectByName(name);
          if (node && node.visible) visibleCoreCount += 1;
        }
        let probeVisibleCount = 0;
        dbg.product.traverse((node: ViewerObject3D) => {
          const n = String(node?.name || "").toLowerCase();
          if ((n.includes("probe") || n === "pivot_pick_volume") && node?.visible) {
            probeVisibleCount += 1;
          }
        });
        if (!dbg.baseShell.geometry.boundingBox) dbg.baseShell.geometry.computeBoundingBox();
        if (!dbg.lidShell.geometry.boundingBox) dbg.lidShell.geometry.computeBoundingBox();
        const baseCenter = dbg.baseShell.geometry.boundingBox.min
          .clone()
          .add(dbg.baseShell.geometry.boundingBox.max)
          .multiplyScalar(0.5);
        const lidCenter = dbg.lidShell.geometry.boundingBox.min
          .clone()
          .add(dbg.lidShell.geometry.boundingBox.max)
          .multiplyScalar(0.5);
        dbg.baseShell.localToWorld(baseCenter);
        dbg.lidShell.localToWorld(lidCenter);
        const dx = baseCenter.x - lidCenter.x;
        const dz = baseCenter.z - lidCenter.z;
        const centerOffsetMm = Math.sqrt(dx * dx + dz * dz) * 1000;
        return { visibleCoreCount, probeVisibleCount, centerOffsetMm };
      });
    } catch {
      await page.waitForTimeout(80);
    }
  }
  return null;
}

async function viewerPivotPinWorldSnapshot(page: Page): Promise<PivotPinWorldSnapshot | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const frame = await getDemoViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await frame.evaluate(() => {
        const dbg = (window as unknown as ViewerWindow).__QIHANG_DEBUG;
        const product = dbg?.product;
        const pin = product?.getObjectByName("Pivot_Pin_Printable");
        if (!product || !pin) return null;
        pin.updateMatrixWorld(true);
        const e = pin.matrixWorld.elements as number[];
        let legacyVisiblePinPartCount = 0;
        product.traverse((node: ViewerObject3D) => {
          if (!node?.visible) return;
          const n = String(node?.name || "");
          if (!n.startsWith("Pivot_Pin_")) return;
          if (n === "Pivot_Pin_Printable" || n === "Pivot_Pin_Retention_Head_L" || n === "Pivot_Pin_Print_Reference") {
            return;
          }
          legacyVisiblePinPartCount += 1;
        });
        return {
          position: [e[12], e[13], e[14]],
          rotation3x3: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]],
          legacyVisiblePinPartCount,
        };
      });
    } catch {
      await page.waitForTimeout(80);
    }
  }
  return null;
}

function maxAbsDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

async function screenshotIframe(page: Page, name: string): Promise<void> {
  await page.locator(VIEWER_IFRAME).screenshot({ path: test.info().outputPath(`${name}.png`) });
}

async function viewerClosedLateralJitterMm(page: Page, sampleCount = 24, intervalMs = 40): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const frame = await getDemoViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(intervalMs);
      continue;
    }
    try {
      const x = await frame.evaluate(() => {
        const dbg = (window as unknown as ViewerWindow).__QIHANG_DEBUG;
        const px = dbg?.lidPivot?.position?.x;
        return typeof px === "number" && Number.isFinite(px) ? px : null;
      });
      if (typeof x === "number") xs.push(x);
    } catch {
      // keep sampling until stable samples are available
    }
    await page.waitForTimeout(intervalMs);
  }
  if (xs.length < 2) return Number.POSITIVE_INFINITY;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return (maxX - minX) * 1000;
}

async function captureAngleBothSides(page: Page, angle: number): Promise<void> {
  await viewerSetState(page, {
    manual_pivot_override: true,
    pivot_angle_deg: angle,
    pivot_swing_side: "left",
    isOpen: angle > 0,
    xrayOn: false,
  });
  await page.waitForTimeout(180);

  await viewerCommand(page, "focus-front-view");
  await page.waitForTimeout(160);
  await screenshotIframe(page, angle === 0 ? "closed_front" : `${angle}deg_front`);

  await viewerCommand(page, "focus-rear-view");
  await page.waitForTimeout(160);
  await screenshotIframe(page, angle === 0 ? "closed_rear" : `${angle}deg_rear`);
}

test("viewer single-axis pivot front+rear no-clipping regression", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/demo");
  await expectDemoViewerVisible(page);

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return String(state?.mech_revision || "");
    }, { timeout: 45_000 })
    .toContain(TARGET_REV);

  await viewerCommand(page, "reset-view");
  await viewerSetState(page, {
    xrayOn: false,
    nightOn: false,
    manual_pivot_override: true,
    pivot_angle_deg: 0,
    isOpen: false,
  });
  await page.waitForTimeout(200);

  await expect
    .poll(async () => Number((await viewerPivotVisualSnapshot(page))?.centerOffsetMm ?? 999), { timeout: 6000 })
    .toBeLessThanOrEqual(0.08);

  const closedVisual = await viewerPivotVisualSnapshot(page);
  expect(closedVisual).not.toBeNull();
  expect(Number(closedVisual?.visibleCoreCount ?? 0)).toBeGreaterThanOrEqual(1);
  expect(Number(closedVisual?.probeVisibleCount ?? 999)).toBe(0);

  await captureAngleBothSides(page, 0);
  for (const angle of [20, 60, 96]) {
    await captureAngleBothSides(page, angle);
  }

  const pinSnapshots = new Map<number, PivotPinWorldSnapshot>();
  for (const angle of [0, 20, 60, 96]) {
    await viewerSetState(page, {
      xrayOn: false,
      manual_pivot_override: true,
      pivot_angle_deg: angle,
      pivot_swing_side: "left",
      isOpen: angle > 0,
    });
    await page.waitForTimeout(140);
    const sample = await viewerPivotPinWorldSnapshot(page);
    expect(sample).not.toBeNull();
    expect(Number(sample?.legacyVisiblePinPartCount ?? 1)).toBe(0);
    pinSnapshots.set(angle, sample as PivotPinWorldSnapshot);
  }
  const pinBaseline = pinSnapshots.get(0) as PivotPinWorldSnapshot;
  for (const angle of [20, 60, 96]) {
    const sample = pinSnapshots.get(angle) as PivotPinWorldSnapshot;
    expect(maxAbsDiff(pinBaseline.position, sample.position)).toBeLessThanOrEqual(1e-9);
    expect(maxAbsDiff(pinBaseline.rotation3x3, sample.rotation3x3)).toBeLessThanOrEqual(1e-9);
  }

  for (const side of ["left", "right"] as const) {
    for (const angle of [0, 20, 60, 96]) {
      await viewerSetState(page, {
        xrayOn: false,
        manual_pivot_override: true,
        pivot_angle_deg: angle,
        pivot_swing_side: side,
        isOpen: angle > 0,
      });
      await page.waitForTimeout(140);
      await expect
        .poll(async () => await viewerPivotHoleAxisDistanceMm(page), { timeout: 5000 })
        .toBeLessThanOrEqual(0.02);
    }
  }

  await viewerSetState(page, {
    xrayOn: false,
    manual_pivot_override: true,
    pivot_angle_deg: 60,
    pivot_swing_side: "left",
    isOpen: true,
  });
  await page.waitForTimeout(120);
  await viewerCommand(page, "focus-pivot-front-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_front_closeup");

  await viewerCommand(page, "focus-pivot-rear-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_rear_closeup");

  for (const angle of [20, 60, 96]) {
    await viewerSetState(page, {
      xrayOn: false,
      manual_pivot_override: true,
      pivot_angle_deg: angle,
      pivot_swing_side: "left",
      isOpen: true,
    });
    await page.waitForTimeout(160);
    await viewerCommand(page, "focus-pivot-rear-corner-view");
    await page.waitForTimeout(180);
    await screenshotIframe(page, `rear_corner_${angle}deg`);
  }

  await viewerSetState(page, {
    xrayOn: true,
    manual_pivot_override: true,
    pivot_angle_deg: 96,
    pivot_swing_side: "left",
    isOpen: true,
  });
  await viewerCommand(page, "focus-pivot-xray-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_xray_rear");

  await viewerSetState(page, {
    xrayOn: false,
    manual_pivot_override: false,
    isOpen: true,
  });
  await viewerCommand(page, "focus-pivot-inspect-view");
  await page.waitForTimeout(220);
  const inspectVisual = await viewerPivotVisualSnapshot(page);
  expect(inspectVisual).not.toBeNull();
  expect(Number(inspectVisual?.probeVisibleCount ?? 0)).toBeGreaterThan(0);
  const inspectStateNoExplode = await viewerGetState(page);
  expect(Number(inspectStateNoExplode?.pivot_spike_violation_count ?? 1)).toBe(0);
  const inspectPinNoExplode = await viewerPivotPinWorldSnapshot(page);
  expect(Number(inspectPinNoExplode?.legacyVisiblePinPartCount ?? 1)).toBe(0);
  await viewerCommand(page, "focus-pivot-front-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_inspect_front");
  await viewerCommand(page, "focus-pivot-rear-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_inspect_rear");

  await viewerCommand(page, "toggle-pivot-explode");
  await page.waitForTimeout(320);
  await viewerCommand(page, "focus-pivot-front-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_explode_front");
  await viewerCommand(page, "focus-pivot-rear-view");
  await page.waitForTimeout(180);
  await screenshotIframe(page, "pivot_explode_rear");
  const inspectState = await viewerGetState(page);
  expect(Boolean(inspectState?.pivot_inspect_active)).toBeTruthy();
  expect(Boolean(inspectState?.pivot_explode_active)).toBeTruthy();
  expect(Number(inspectState?.pivot_spike_violation_count ?? 1)).toBe(0);
  expect(Number(inspectState?.pivot_module_count || 0)).toBe(5);
  expect(Number(inspectState?.pivot_inspect_min_clearance_mm || 0)).toBeGreaterThanOrEqual(0.3);
  const inspectPinExplode = await viewerPivotPinWorldSnapshot(page);
  expect(Number(inspectPinExplode?.legacyVisiblePinPartCount ?? 1)).toBe(0);

  await viewerCommand(page, "toggle-pivot-explode");
  await page.waitForTimeout(120);
  await viewerCommand(page, "toggle-pivot-inspect");
  await page.waitForTimeout(120);
  const backToNormalVisual = await viewerPivotVisualSnapshot(page);
  expect(Number(backToNormalVisual?.probeVisibleCount ?? 999)).toBe(0);

  await viewerSetState(page, {
    xrayOn: false,
    manual_pivot_override: true,
    pivot_angle_deg: 0,
    pivot_swing_side: "right",
    isOpen: false,
  });
  await page.waitForTimeout(120);
  await viewerSetState(page, {
    manual_pivot_override: false,
    pivot_swing_side: "right",
    isOpen: false,
  });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return state?.pivot_state || "";
    }, { timeout: 5_000 })
    .toBe("closed");

  const t0 = Date.now();
  await viewerCommand(page, "open");

  let finalState: ViewerState | null = null;
  for (let i = 0; i < 140; i += 1) {
    finalState = await viewerGetState(page);
    if (finalState && finalState.pivot_state === "open" && Number(finalState.pivot_angle_deg || 0) >= 95) {
      break;
    }
    await page.waitForTimeout(25);
  }
  const elapsedMs = Date.now() - t0;
  await page.waitForTimeout(140);
  const settledState = await viewerGetState(page);

  expect(finalState).not.toBeNull();
  expect(finalState?.pivot_state).toBe("open");
  expect(Number(finalState?.pivot_angle_deg || 0)).toBeGreaterThanOrEqual(95);
  expect(String(finalState?.pivot_swing_side || "")).toBe("right");
  expect(elapsedMs).toBeGreaterThanOrEqual(900);
  expect(elapsedMs).toBeLessThanOrEqual(2200);

  const tClose = Date.now();
  await viewerCommand(page, "close");
  let closedState: ViewerState | null = null;
  for (let i = 0; i < 140; i += 1) {
    closedState = await viewerGetState(page);
    if (
      closedState &&
      closedState.pivot_state === "closed" &&
      Number(closedState.pivot_angle_deg ?? 999) <= 0.6
    ) {
      break;
    }
    await page.waitForTimeout(25);
  }
  const closeElapsedMs = Date.now() - tClose;
  expect(closedState).not.toBeNull();
  expect(closedState?.pivot_state).toBe("closed");
  expect(Number(closedState?.pivot_angle_deg ?? 999)).toBeLessThanOrEqual(0.6);
  expect(closeElapsedMs).toBeGreaterThanOrEqual(900);
  expect(closeElapsedMs).toBeLessThanOrEqual(2400);
  await expect
    .poll(async () => Number((await viewerGetState(page))?.closed_lateral_jitter_mm ?? Number.POSITIVE_INFINITY), {
      timeout: 4000,
    })
    .toBeLessThanOrEqual(0.08);
  await page.waitForTimeout(180);
  const closedLateralJitterMm = await viewerClosedLateralJitterMm(page);
  expect(closedLateralJitterMm).toBeLessThanOrEqual(0.08);

  expect(Number(settledState?.pivot_path_safe_open_deg || 0)).toBeGreaterThanOrEqual(96);
  expect(Number(settledState?.pivot_path_min_clearance_mm || 0)).toBeGreaterThanOrEqual(0.15);
  expect(Number(settledState?.pivot_shell_min_clearance_mm || 0)).toBeGreaterThanOrEqual(0.2);
  expect(Number(settledState?.pivot_rear_corner_min_clearance_mm || 0)).toBeGreaterThanOrEqual(0.22);
  expect(Number(settledState?.pivot_clearance_sample_count || 0)).toBeGreaterThanOrEqual(40);
  expect(Number(settledState?.pivot_clearance_sample_step_deg || 0)).toBeGreaterThanOrEqual(1);
  expect(Number(settledState?.pivot_clearance_sample_step_deg || 0)).toBeLessThanOrEqual(2);
  expect(Number(settledState?.pivot_notch_peak_over_cap_mm || 0)).toBeLessThanOrEqual(0);
  expect(Number(settledState?.pivot_spike_violation_count || 0)).toBe(0);
  expect(Boolean(settledState?.pivot_clip_guard_active)).toBeFalsy();
  expect(Number(settledState?.pivot_open_elapsed_ms || 0)).toBeGreaterThan(0);
  expect(Number(settledState?.pivot_axis_count || 0)).toBe(1);
  expect(String(settledState?.pivot_layout || "")).toBe("tail_pivot_fixed_pin_lid_keyslot_v5");
  expect(Boolean(settledState?.pivot_inspect_active)).toBeFalsy();
  expect(Boolean(settledState?.pivot_explode_active)).toBeFalsy();
  expect(Number(settledState?.pivot_module_count || 0)).toBe(5);
});
