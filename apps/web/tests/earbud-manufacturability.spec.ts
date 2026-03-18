import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type {
  ViewerObject3D,
  ViewerWindow,
} from "./helpers/viewer-runtime";
import {
  expectDemoViewerVisible,
  getDemoViewerFrame,
  waitForDemoConnected,
} from "./helpers/demo-viewer";

const DEMO_PATH = "/demo";

type ViewerRuntimeSnapshot = {
  leftMeshCount: number;
  rightMeshCount: number;
  state: Record<string, unknown>;
};

test("viewer earbud GLB mount keeps explicit right-ear clone semantics", async () => {
  const html = readFileSync(
    path.resolve(__dirname, "../public/product-viewer.html"),
    "utf8",
  );

  expect(html).toContain('const sourceEarR=findNodeByAliases');
  expect(html).toContain('mountGlbPart(sourceRoot,sourceEarL,earL,"GLB_Ear_Left"');
  expect(html).toContain('mountGlbPart(sourceRoot,sourceEarR,earR,"GLB_Ear_Right"');
  expect(html).not.toContain('canonicalEarSource');
});

test("procedural fallback remains visible and preserves earbud fit telemetry", async ({ page }) => {
  await page.route("**/product-assets/*.glb", (route) => route.abort());
  await page.route("**/product.glb", (route) => route.abort());

  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 8000);

  const frame = await getDemoViewerFrame(page);
  expect(frame).not.toBeNull();

  let snapshot: ViewerRuntimeSnapshot | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activeFrame = await getDemoViewerFrame(page);
    if (!activeFrame) {
      await page.waitForTimeout(250);
      continue;
    }
    try {
      const current = (await activeFrame.evaluate(() => {
        const win = window as unknown as ViewerWindow;
        const dbg = win?.__QIHANG_DEBUG;
        const state = win?.QIHANG_MODEL?.getState?.() || {};

        const leftRoot = dbg?.product?.getObjectByName("Earbud_Left");
        const rightRoot = dbg?.product?.getObjectByName("Earbud_Right");

        const countMeshes = (node: ViewerObject3D | null | undefined) => {
          if (!node) return 0;
          let count = 0;
          node.traverse((child: ViewerObject3D) => {
            if (child?.isMesh) count += 1;
          });
          return count;
        };

        return {
          leftMeshCount: countMeshes(leftRoot),
          rightMeshCount: countMeshes(rightRoot),
          state,
        } as ViewerRuntimeSnapshot;
      })) as ViewerRuntimeSnapshot;
      snapshot = current;
      if (current.leftMeshCount > 0 && current.rightMeshCount > 0) {
        break;
      }
    } catch {
      // keep polling until fallback meshes are fully mounted
    }
    await page.waitForTimeout(250);
  }

  expect(snapshot).not.toBeNull();
  const stableSnapshot = snapshot as ViewerRuntimeSnapshot;

  expect(stableSnapshot.leftMeshCount).toBeGreaterThan(0);
  expect(stableSnapshot.rightMeshCount).toBeGreaterThan(0);
  expect(Number(stableSnapshot.state.earbud_fit_clearance_mm ?? 0)).toBeGreaterThanOrEqual(0.5);
  expect(Number(stableSnapshot.state.earbud_fit_clearance_mm ?? 0)).toBeLessThanOrEqual(1.6);
  expect(Boolean(stableSnapshot.state.earbud_contact_engaged_l)).toBeTruthy();
  expect(Boolean(stableSnapshot.state.earbud_contact_engaged_r)).toBeTruthy();
  expect(Number(stableSnapshot.state.earbud_module_overlap_count ?? 99)).toBe(0);
});
