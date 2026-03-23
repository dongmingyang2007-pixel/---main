import { expect, test, type Page } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

async function switchToOmniRealtime(page: Page) {
  await page.getByRole("button", { name: /Omni 实时/ }).click();
}

async function switchToSyntheticRealtime(page: Page) {
  await page.getByRole("button", { name: /合成实时/ }).click();
}

async function forceSelectRealtimeProject(page: Page, projectId: string) {
  await page.evaluate(({ nextProjectId }) => {
    const select = document.querySelector<HTMLSelectElement>(".inline-topbar-project-select");
    if (!select) {
      return;
    }
    if (!Array.from(select.options).some((option) => option.value === nextProjectId)) {
      const option = document.createElement("option");
      option.value = nextProjectId;
      option.textContent = nextProjectId;
      select.appendChild(option);
    }
  }, { nextProjectId: projectId });
  await page.locator(".inline-topbar-project-select").selectOption(projectId);
}

async function ensureRealtimeConversationReady(page: Page, projectId: string) {
  const activeConversation = page.locator(".chat-sidebar-item.is-active");
  try {
    await expect(activeConversation).toBeVisible({ timeout: 8000 });
    return;
  } catch {
    await forceSelectRealtimeProject(page, projectId);
    try {
      await expect(activeConversation).toBeVisible({ timeout: 8000 });
      return;
    } catch {
      // Fall through to the manual create path below.
    }
    const newConversationButton = page.locator(".chat-sidebar-new");
    await expect(newConversationButton).toBeEnabled({ timeout: 8000 });
    await newConversationButton.click();
    await expect(activeConversation).toBeVisible();
  }
}

async function installRealtimeVoiceMocks(
  page: Page,
  scenario:
    | "success"
    | "permission-denied"
    | "turn-error"
    | "partial-first"
    | "synthetic-echo"
    | "synthetic-autoplay",
) {
  await page.evaluate(
    ({ activeScenario }) => {
      const mockProcessors: MockScriptProcessor[] = [];

      const emitSpeechFrame = (amplitude = 0.25) => {
        const frame = new Float32Array(4096).fill(amplitude);
        for (const processor of mockProcessors) {
          processor.onaudioprocess?.({
            inputBuffer: {
              getChannelData: () => frame,
            },
          });
        }
      };

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

        constructor() {
          mockProcessors.push(this);
        }

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

      if (activeScenario === "synthetic-autoplay") {
        const mockAudioStats = {
          primed: 0,
          replyPlays: 0,
        };
        let unlocked = false;
        Object.defineProperty(window, "__mockAudioStats", {
          configurable: true,
          value: mockAudioStats,
        });
        Object.defineProperty(globalThis, "__mockAudioStats", {
          configurable: true,
          value: mockAudioStats,
        });
        Object.defineProperty(HTMLMediaElement.prototype, "play", {
          configurable: true,
          value() {
            const media = this as HTMLMediaElement;
            const src = media.currentSrc || media.src || "";
            if (src.startsWith("data:audio/wav;base64,")) {
              unlocked = true;
              mockAudioStats.primed += 1;
              return Promise.resolve();
            }
            if (!unlocked) {
              return Promise.reject(new DOMException("autoplay blocked", "NotAllowedError"));
            }
            mockAudioStats.replyPlays += 1;
            setTimeout(() => {
              media.onended?.(new Event("ended"));
            }, 0);
            return Promise.resolve();
          },
        });
        Object.defineProperty(HTMLMediaElement.prototype, "pause", {
          configurable: true,
          value() {
            return undefined;
          },
        });
        Object.defineProperty(HTMLMediaElement.prototype, "load", {
          configurable: true,
          value() {
            return undefined;
          },
        });
      }

      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        readonly url: string;
        readyState = MockWebSocket.CONNECTING;
        binaryType = "blob";
        onopen: ((event: unknown) => void) | null = null;
        onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null = null;
        onclose: ((event: { code: number; reason: string }) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        assistantTurnOpen = false;
        interrupted = false;

        constructor(url: string) {
          this.url = url;
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.onopen?.({});
          }, 0);
        }

        send(data: string | ArrayBuffer) {
          if (typeof data !== "string") {
            if (
              activeScenario === "synthetic-echo" &&
              this.url.includes("/api/v1/realtime/composed-voice") &&
              this.assistantTurnOpen
            ) {
              this.interrupted = true;
              this.assistantTurnOpen = false;
              setTimeout(() => {
                this.onmessage?.({ data: JSON.stringify({ type: "interrupt.ack" }) });
              }, 0);
            }
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
            } else if (activeScenario === "partial-first") {
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.partial", text: "语" }),
                });
              }, 20);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.partial", text: "语音" }),
                });
              }, 80);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "语音问题" }),
                });
              }, 160);
            } else if (activeScenario === "synthetic-echo" && this.url.includes("/api/v1/realtime/composed-voice")) {
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "第一句" }),
                });
              }, 30);
              setTimeout(() => {
                this.assistantTurnOpen = true;
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.text", text: "第一句回复" }),
                });
              }, 70);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "audio.meta", mime: "audio/mpeg" }),
                });
              }, 80);
              setTimeout(() => {
                this.onmessage?.({
                  data: new Blob(["mock-audio-1"], { type: "audio/mpeg" }),
                });
              }, 90);
              setTimeout(() => {
                emitSpeechFrame();
              }, 100);
              setTimeout(() => {
                if (!this.interrupted) {
                  this.assistantTurnOpen = false;
                  this.onmessage?.({
                    data: JSON.stringify({ type: "response.done" }),
                  });
                }
              }, 130);
              setTimeout(() => {
                this.interrupted = false;
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "第二句" }),
                });
              }, 190);
              setTimeout(() => {
                this.assistantTurnOpen = true;
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.text", text: "第二句回复" }),
                });
              }, 230);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "audio.meta", mime: "audio/mpeg" }),
                });
              }, 240);
              setTimeout(() => {
                this.onmessage?.({
                  data: new Blob(["mock-audio-2"], { type: "audio/mpeg" }),
                });
              }, 250);
              setTimeout(() => {
                if (!this.interrupted) {
                  this.assistantTurnOpen = false;
                  this.onmessage?.({
                    data: JSON.stringify({ type: "response.done" }),
                  });
                }
              }, 290);
            } else if (activeScenario === "synthetic-autoplay" && this.url.includes("/api/v1/realtime/composed-voice")) {
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "transcript.final", text: "帮我播报结果" }),
                });
              }, 30);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.text", text: "这是自动播报的回复。" }),
                });
              }, 70);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "audio.meta", mime: "audio/mpeg" }),
                });
              }, 90);
              setTimeout(() => {
                this.onmessage?.({
                  data: new Blob(["mock-audio-autoplay"], { type: "audio/mpeg" }),
                });
              }, 110);
              setTimeout(() => {
                this.onmessage?.({
                  data: JSON.stringify({ type: "response.done" }),
                });
              }, 150);
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
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
    await switchToOmniRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".rt-entry-label")).toHaveText("重试对话");
  });

  test("completed realtime turns sync into the chat pane and sidebar immediately", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "success");
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
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
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
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

  test("partial transcripts appear in the chat pane before the final transcript lands", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "partial-first");
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
    await switchToOmniRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".chat-message.is-user").last()).toContainText("语");
    await expect(page.locator(".chat-message.is-user").last()).toContainText("语音");
    await expect(page.locator(".chat-message.is-user").last()).toContainText("语音问题");
  });

  test("synthetic realtime keeps completed turns instead of overwriting the latest utterance", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "synthetic-echo");
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
    await switchToSyntheticRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".chat-message.is-user").last()).toContainText("第二句");
    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("第二句回复");

    const userTexts = await page.locator(".chat-message.is-user").allTextContents();
    const assistantTexts = await page.locator(".chat-message.is-assistant").allTextContents();
    expect(userTexts.join("\n")).toContain("第一句");
    expect(userTexts.join("\n")).toContain("第二句");
    expect(assistantTexts.join("\n")).toContain("第一句回复");
    expect(assistantTexts.join("\n")).toContain("第二句回复");
  });

  test("synthetic realtime primes playback so spoken replies autoplay", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await installRealtimeVoiceMocks(page, "synthetic-autoplay");
    await ensureRealtimeConversationReady(page, handle.seedProjectId);
    await switchToSyntheticRealtime(page);
    await expect(page.locator(".rt-entry")).toBeVisible();

    await page.locator(".rt-entry").click();

    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("这是自动播报的回复。");
    await expect
      .poll(() => page.evaluate(() => (window as { __mockAudioStats?: { primed: number } }).__mockAudioStats?.primed ?? 0))
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as { __mockAudioStats?: { replyPlays: number } }).__mockAudioStats?.replyPlays ?? 0))
      .toBe(1);
    await expect(page.locator(".chat-voice-indicator.is-error")).toHaveCount(0);
  });
});
