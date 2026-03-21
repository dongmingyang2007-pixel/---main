import { expect, test, type Page } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

async function switchToOmniRealtime(page: Page) {
  await page.getByRole("button", { name: /Omni 实时/ }).click();
}

async function installRealtimeVoiceMocks(
  page: Page,
  scenario: "success" | "permission-denied" | "turn-error",
) {
  await page.evaluate(
    ({ activeScenario }) => {
      class MockAudioBuffer {
        duration: number;
        channelData: Float32Array;

        constructor(length: number, sampleRate: number) {
          this.duration = length / sampleRate;
          this.channelData = new Float32Array(length);
        }

        getChannelData() {
          return this.channelData;
        }
      }

      class MockBufferSource {
        buffer: MockAudioBuffer | null = null;

        connect() {
          return undefined;
        }

        start() {
          return undefined;
        }
      }

      class MockMediaStreamSource {
        connect() {
          return undefined;
        }
      }

      class MockScriptProcessor {
        onaudioprocess: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null;

        connect() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }

      class MockGainNode {
        gain = { value: 1 };

        connect() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }

      class MockAudioContext {
        static readonly sampleRate = 24000;
        state: "running" | "suspended" | "closed" = "running";
        currentTime = 0;
        destination = {};

        constructor() {}

        resume() {
          this.state = "running";
          return Promise.resolve();
        }

        close() {
          this.state = "closed";
          return Promise.resolve();
        }

        createBuffer(_channels: number, length: number, sampleRate: number) {
          return new MockAudioBuffer(length, sampleRate);
        }

        createBufferSource() {
          return new MockBufferSource();
        }

        createMediaStreamSource() {
          return new MockMediaStreamSource();
        }

        createScriptProcessor() {
          return new MockScriptProcessor();
        }

        createGain() {
          return new MockGainNode();
        }
      }

      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        writable: true,
        value: MockAudioContext,
      });
      Object.defineProperty(globalThis, "AudioContext", {
        configurable: true,
        writable: true,
        value: MockAudioContext,
      });

      Object.defineProperty(window.navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => {
            if (activeScenario === "permission-denied") {
              return Promise.reject(new Error("permission denied"));
            }
            return Promise.resolve({
              getTracks: () => [{ stop() {} }],
            });
          },
        },
      });

      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        readonly url: string;
        readyState = MockWebSocket.CONNECTING;
        binaryType = "blob";
        onopen: ((event: unknown) => void) | null = null;
        onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
        onclose: ((event: { code: number; reason: string }) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;

        constructor(url: string) {
          this.url = url;
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.onopen?.({});
          }, 0);
        }

        send(data: string | ArrayBuffer) {
          if (typeof data !== "string") {
            return;
          }

          const payload = JSON.parse(data);
          if (payload.type === "session.start") {
            setTimeout(() => {
              this.onmessage?.({ data: JSON.stringify({ type: "session.ready" }) });
            }, 0);

            if (activeScenario === "success") {
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "语音问题" }),
                });
              }, 30);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.text", text: "语音回答" }),
                });
              }, 60);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.done" }),
                });
              }, 90);
            } else if (activeScenario === "turn-error") {
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "语音问题" }),
                });
              }, 30);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.text", text: "回答到一半" }),
                });
              }, 60);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "turn.error", message: "AI 暂时无响应，请重试" }),
                });
              }, 90);
            }
            return;
          }

          if (payload.type === "session.end") {
            this.close(1000, "client_end");
          }
        }

        close(code = 1000, reason = "") {
          if (this.readyState === MockWebSocket.CLOSED) {
            return;
          }
          this.readyState = MockWebSocket.CLOSED;
          setTimeout(() => {
            this.onclose?.({ code, reason });
          }, 0);
        }
      }

      Object.defineProperty(window, "WebSocket", {
        configurable: true,
        writable: true,
        value: MockWebSocket,
      });
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        writable: true,
        value: MockWebSocket,
      });
    },
    { activeScenario: scenario },
  );
}

test.describe("Realtime Voice", () => {
  test("microphone denial returns the widget to retry state", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "permission-denied");
    await page.locator(".chat-sidebar-new").click();
    await switchToOmniRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".rt-entry-label")).toHaveText("重试对话");
  });

  test("completed realtime turns sync into the chat pane and sidebar immediately", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "success");
    await page.locator(".chat-sidebar-new").click();
    await switchToOmniRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".chat-message.is-user").last()).toContainText("语音问题");
    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("语音回答");
    await expect(page.locator(".chat-sidebar-item.is-active")).toContainText("语音问题");
  });

  test("turn errors keep realtime session interactive instead of dropping to retry", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "turn-error");
    await page.locator(".chat-sidebar-new").click();
    await switchToOmniRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".chat-message.is-user").last()).toContainText("语音问题");
    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("回答到一半");
    await expect(page.locator(".rt-pill")).toBeVisible();
    await expect(page.locator(".rt-pill-status")).toHaveText("聆听中");
    await expect(page.locator(".chat-voice-indicator.is-error")).toContainText("AI 暂时无响应，请重试");
    await expect(page.locator(".rt-entry-label")).toHaveCount(0);
  });
});
