import { expect, test, type Page } from "@playwright/test";
import type {
  ViewerObject3D,
  ViewerWindow,
} from "./helpers/viewer-runtime";

const DEMO_PATH = "/demo";
const VIEWER_IFRAME = 'iframe[title="MingRun Demo Model"]';

type ViewerRuntimeSnapshot = {
  leftMeshCount: number;
  rightMeshCount: number;
  state: Record<string, unknown>;
};

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
        return status === "已连接" && commandCount > 0;
      });
    }, { timeout })
    .toBeTruthy();
}

test("viewer source maps right ear GLB from sourceEarR", async ({ request }) => {
  const response = await request.get("/product-viewer.html");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  expect(html).toContain('mountGlbPart(sourceRoot,sourceEarR,earR,"GLB_Ear_Right"');
  expect(html).not.toContain('mountGlbPart(sourceRoot,sourceEarL,earR,"GLB_Ear_Right"');
});

test("procedural fallback remains visible and reports manufacturable state", async ({ page }) => {
  await page.route("**/product-assets/*.glb", (route) => route.abort());
  await page.route("**/product.glb", (route) => route.abort());

  await page.goto(DEMO_PATH);
  await expect(page.locator(VIEWER_IFRAME)).toBeVisible();
  await waitForConnected(page, 8000);

  const frame = await getViewerFrame(page);
  expect(frame).not.toBeNull();

  let snapshot: ViewerRuntimeSnapshot | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activeFrame = await getViewerFrame(page);
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
  expect(Number(stableSnapshot.state.earbud_fit_clearance_mm ?? 0)).toBeLessThanOrEqual(1.0);
  expect(Boolean(stableSnapshot.state.earbud_contact_engaged_l)).toBeTruthy();
  expect(Boolean(stableSnapshot.state.earbud_contact_engaged_r)).toBeTruthy();
  expect(Number(stableSnapshot.state.earbud_module_overlap_count ?? 99)).toBe(0);
});
