import { expect, type Frame, type Page } from "@playwright/test";

import { VIEWER_REVISION } from "../../lib/qihang-viewer-contract";
import type { ViewerWindow } from "./viewer-runtime";

export const DEMO_VIEWER_IFRAME = "iframe.demo-iframe";
export const DEMO_VIEWER_REVISION = VIEWER_REVISION;

const COMMAND_READY_LABELS = [
  "重置视角",
  "正视机位",
  "背视机位",
  "左耳近景",
  "右耳近景",
  "导出 GLB",
  "导出 STL Pack",
];

export async function expectDemoViewerVisible(page: Page, timeout = 5000): Promise<void> {
  await expect(page.locator(DEMO_VIEWER_IFRAME)).toBeVisible({ timeout });
}

export async function getDemoViewerFrame(page: Page): Promise<Frame | null> {
  const iframe = await page.$(DEMO_VIEWER_IFRAME);
  if (!iframe) return null;
  return iframe.contentFrame();
}

export async function openDemoAdvancedControls(page: Page): Promise<void> {
  await page.locator("details").first().evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  await expect(page.getByRole("button", { name: "重置视角" })).toBeVisible();
}

async function readReadyCommandCount(page: Page): Promise<number> {
  return page.locator("button").evaluateAll((buttons, labels) => {
    const allowed = new Set(labels as string[]);
    return buttons.filter((button) => {
      const label = (button.textContent || "").trim();
      return allowed.has(label) && !button.hasAttribute("disabled");
    }).length;
  }, COMMAND_READY_LABELS);
}

async function withDemoViewerFrame<T>(
  page: Page,
  action: (frame: Frame) => Promise<T>,
  fallback: T,
  attempts = 4,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const frame = await getDemoViewerFrame(page);
    if (!frame) {
      await page.waitForTimeout(80);
      continue;
    }
    try {
      return await action(frame);
    } catch {
      await page.waitForTimeout(80);
    }
  }

  return fallback;
}

export async function demoViewerGetState(page: Page): Promise<Record<string, unknown>> {
  return withDemoViewerFrame(
    page,
    async (frame) =>
      await frame.evaluate(() => {
        const win = window as unknown as ViewerWindow;
        return win?.QIHANG_MODEL?.getState?.() || {};
      }),
    {},
  );
}

export async function demoViewerSetState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await withDemoViewerFrame(
    page,
    async (frame) => {
      await frame.evaluate((statePatch) => {
        const win = window as unknown as ViewerWindow;
        win?.QIHANG_MODEL?.setState?.(statePatch);
      }, patch);
    },
    undefined,
  );
}

export async function demoViewerCommand(page: Page, name: string): Promise<void> {
  await withDemoViewerFrame(
    page,
    async (frame) => {
      await frame.evaluate((commandName) => {
        const win = window as unknown as ViewerWindow;
        win?.QIHANG_MODEL?.command?.(commandName);
      }, name);
    },
    undefined,
  );
}

export async function readDemoBridgeSnapshot(page: Page): Promise<{
  status: string;
  commandCount: number;
  text: string;
}> {
  const [status, commandCount, text] = await Promise.all([
    page.locator(".demo-controls").getByText(/已连接|降级连接|连接中|连接超时/).first().textContent(),
    readReadyCommandCount(page),
    page.evaluate(() => document.body.innerText),
  ]);
  return { status: status?.trim() || "", commandCount, text };
}

export async function waitForDemoConnected(page: Page, timeout = 6000): Promise<void> {
  await expectDemoViewerVisible(page, timeout);
  await openDemoAdvancedControls(page);
  await expect
    .poll(async () => {
      const snap = await readDemoBridgeSnapshot(page);
      const frame = await getDemoViewerFrame(page);
      if (!frame) return false;
      try {
        const readiness = await frame.evaluate(() => {
          const win = window as unknown as ViewerWindow;
          const hasApi = Boolean(win?.QIHANG_MODEL?.getState && win?.QIHANG_MODEL?.setState && win?.QIHANG_MODEL?.command);
          const state = (win?.QIHANG_MODEL?.getState?.() || {}) as Record<string, unknown>;
          return {
            hasApi,
            stateReady: Object.keys(state).length > 0,
          };
        });
        return readiness.hasApi && readiness.stateReady && snap.status !== "连接超时";
      } catch {
        return false;
      }
    }, { timeout })
    .toBeTruthy();
}

export async function postToDemoViewer(
  page: Page,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ selector, messageType, messagePayload }) => {
      const iframe = document.querySelector(selector) as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(
        {
          source: "qihang-web",
          type: messageType,
          payload: messagePayload,
        },
        window.location.origin,
      );
    },
    {
      selector: DEMO_VIEWER_IFRAME,
      messageType: type,
      messagePayload: payload,
    },
  );
}
