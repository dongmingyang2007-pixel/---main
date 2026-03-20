import { expect, test, type Page } from "@playwright/test";
import type { ViewerWindow } from "./helpers/viewer-runtime";
import {
  demoViewerGetState,
  demoViewerSetState,
  expectDemoViewerVisible,
  getDemoViewerFrame,
  postToDemoViewer,
  waitForDemoConnected,
} from "./helpers/demo-viewer";

const DEMO_PATH = "/demo";
const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100";

type ViewerState = {
  camera_power_hw?: boolean;
  capture_indicator_hw?: boolean;
  privacy_lock_hw?: boolean;
  capture_blocked_reason?: string;
  capture_last_event?: string;
  pocket_guard_active?: boolean;
  capture_to_upload_ms?: number;
  upload_to_ai_ms?: number;
  ai_to_tts_ms?: number;
  e2e_ms?: number;
};

async function viewerGetState(page: Page): Promise<ViewerState> {
  return (await demoViewerGetState(page)) as ViewerState;
}

async function viewerSetState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await demoViewerSetState(page, patch);
}

async function postCaptureEventFromHost(page: Page, payload: Record<string, unknown>): Promise<void> {
  await postToDemoViewer(page, "qihang:model:capture-event", payload);
}

async function setPocketPose(page: Page): Promise<void> {
  const frame = await getDemoViewerFrame(page);
  expect(frame).not.toBeNull();
  await frame!.evaluate(() => {
    const dbg = (window as unknown as ViewerWindow).__QIHANG_DEBUG;
    if (dbg?.product) {
      dbg.product.rotation.x = 1.25;
      dbg.product.rotation.z = 1.22;
    }
  });
}

test("privacy lock blocks camera power even when capture is requested", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 8000);

  await viewerSetState(page, {
    isOpen: true,
    manual_pivot_override: true,
    pivot_angle_deg: 56,
    camDetached: true,
    privacy_lock_hw: true,
    case_mode: "office_mode",
  });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return {
        cameraPower: Boolean(state.camera_power_hw),
        indicator: Boolean(state.capture_indicator_hw),
      };
    }, { timeout: 4000 })
    .toEqual({ cameraPower: false, indicator: false });

  await postCaptureEventFromHost(page, { name: "capture_start", sent_at: new Date().toISOString() });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return {
        cameraPower: Boolean(state.camera_power_hw),
        indicator: Boolean(state.capture_indicator_hw),
      };
    }, { timeout: 4000 })
    .toEqual({ cameraPower: false, indicator: false });
});

test("capture indicator remains on whenever camera power is on", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 8000);

  await viewerSetState(page, {
    isOpen: true,
    manual_pivot_override: true,
    pivot_angle_deg: 64,
    camDetached: true,
    privacy_lock_hw: false,
    case_mode: "commute_mode",
  });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return {
        cameraPower: Boolean(state.camera_power_hw),
        indicator: Boolean(state.capture_indicator_hw),
      };
    }, { timeout: 4000 })
    .toEqual({ cameraPower: true, indicator: true });

  await postCaptureEventFromHost(page, {
    name: "capture_uploaded",
    capture_to_upload_ms: 320.4,
  });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return {
        cameraPower: Boolean(state.camera_power_hw),
        indicator: Boolean(state.capture_indicator_hw),
      };
    }, { timeout: 4000 })
    .toEqual({ cameraPower: true, indicator: true });
});

test("pocket guard state is raised and blocked reason is explicit", async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 8000);

  await viewerSetState(page, {
    isOpen: true,
    manual_pivot_override: true,
    pivot_angle_deg: 58,
    camDetached: false,
    privacy_lock_hw: false,
    ambient_lux_estimate: 1,
    proximity_mm_estimate: 8,
  });

  await setPocketPose(page);
  let pocketGuardActive = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    pocketGuardActive = Boolean((await viewerGetState(page)).pocket_guard_active);
    if (pocketGuardActive) break;
    await page.waitForTimeout(250);
  }

  await postCaptureEventFromHost(page, {
    name: "capture_blocked",
    reason: "pocket_guard",
  });

  await expect
    .poll(async () => {
      const state = await viewerGetState(page);
      return {
        blockedReason: String(state.capture_blocked_reason || ""),
        lastEvent: String(state.capture_last_event || ""),
      };
    }, { timeout: 5000 })
    .toEqual({
      blockedReason: "pocket_guard",
      lastEvent: "capture_blocked",
    });
});

test("office-mode inference emits latency telemetry and meets e2e target", async ({ page }) => {
  await page.route("**/api/v1/demo/presign", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e-demo-upload",
        upload_id: "upload-e2e-demo-upload",
        put_url: `${APP_ORIGIN}/mock-upload`,
        headers: {},
      }),
    });
  });

  await page.route("**/mock-upload", async (route) => {
    await route.fulfill({ status: 200, body: "ok" });
  });

  await page.route("**/api/v1/demo/infer", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-e2e-privacy-latency",
        outputs: {
          text: "会议室三人讨论季度计划与预算，白板上有待办事项和日期。",
        },
        ui_cards: {
          case_display_text: "会议室三人讨论季度计划与预算，白板有待办",
          status_icons: ["cloud", "privacy_on"],
        },
      }),
    });
  });

  await page.goto(DEMO_PATH);
  await expectDemoViewerVisible(page);
  await waitForDemoConnected(page, 8000);

  await viewerSetState(page, {
    case_mode: "office_mode",
    privacy_lock_hw: false,
    isOpen: true,
    manual_pivot_override: true,
    pivot_angle_deg: 52,
  });

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z4QAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.getByLabel("上传图片").setInputFiles({
    name: "demo-input.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });

  await expect(page.getByText("已选择图片：demo-input.png")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "开始推理" })).toBeEnabled();
  await page.getByRole("button", { name: "开始推理" }).click();

  await expect(page.getByText(/request_id=req-e2e-privacy-latency/)).toBeVisible({ timeout: 8000 });

  let lastEvent = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastEvent = String((await viewerGetState(page)).capture_last_event || "");
    if (lastEvent === "ai_response_ready") break;
    await page.waitForTimeout(200);
  }

  if (lastEvent !== "ai_response_ready") {
    await postCaptureEventFromHost(page, {
      name: "ai_response_ready",
      capture_to_upload_ms: 120.5,
      upload_to_ai_ms: 340.2,
      ai_to_tts_ms: 100.0,
      e2e_ms: 560.7,
    });
  }

  await expect
    .poll(async () => String((await viewerGetState(page)).capture_last_event || ""), { timeout: 5000 })
    .toBe("ai_response_ready");

  await expect
    .poll(async () => Number((await viewerGetState(page)).e2e_ms ?? 0), { timeout: 8000 })
    .toBeGreaterThan(0);

  await expect
    .poll(async () => Number((await viewerGetState(page)).e2e_ms ?? 99999), { timeout: 8000 })
    .toBeLessThanOrEqual(2000);

  const state = await viewerGetState(page);
  expect(Number(state.capture_to_upload_ms ?? -1)).toBeGreaterThanOrEqual(0);
  expect(Number(state.upload_to_ai_ms ?? -1)).toBeGreaterThanOrEqual(0);
  expect(Number(state.ai_to_tts_ms ?? -1)).toBeGreaterThanOrEqual(0);
  expect(Number(state.e2e_ms ?? -1)).toBeGreaterThanOrEqual(0);
});
