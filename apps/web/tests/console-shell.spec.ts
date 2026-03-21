import { expect, test, type Page } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

async function stubBrowserVoiceApis(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value() {
        return Promise.resolve();
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value() {
        return undefined;
      },
    });

    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      stream = {
        getTracks: () => [{ stop() {} }],
      };

      constructor(
        stream: { getTracks: () => Array<{ stop: () => void }> },
        options?: { mimeType?: string },
      ) {
        this.stream = stream;
        this.mimeType = options?.mimeType || "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["mock-audio"], { type: this.mimeType }),
        });
        this.onstop?.();
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    });
  });
}

test.describe("Console Shell", () => {
  test.beforeEach(async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
  });

  test("applies console theme attributes", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("[data-theme='console']").first()).toBeVisible();
    await expect(page.locator("header.site-header-v2.is-console")).toBeVisible();
  });

  test("IconBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".sidebar-v2")).toBeVisible();
  });

  test("IconBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".sidebar-v2")).not.toBeVisible();
  });

  test("inline top bar renders with breadcrumbs", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".inline-topbar")).toBeVisible();
    await expect(page.locator(".inline-topbar-breadcrumb")).toContainText("仪表盘");
  });

  test("StatusBar visible on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await expect(page.locator(".statusbar")).toBeVisible();
  });

  test("StatusBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".statusbar")).not.toBeVisible();
  });

  test("Cmd+K opens command palette", async ({ page }) => {
    const accessibilityWarnings: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("DialogContent requires a DialogTitle")) {
        accessibilityWarnings.push(text);
      }
    });

    await page.goto("/app");
    await page.keyboard.press("Meta+k");
    await expect(page.locator("[role='dialog']")).toBeVisible();
    await expect(page.getByPlaceholder("输入命令或搜索…")).toBeVisible();
    expect(accessibilityWarnings).toEqual([]);
  });

  test("navigation works via IconBar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app");
    await page.getByRole("link", { name: "对话" }).click();
    await expect(page).toHaveURL(/\/app\/chat$/);
  });

  test("english console shell also renders correctly", async ({ page }) => {
    await page.goto("/en/app");
    await expect(page.locator("header.site-header-v2.is-console")).toContainText("Mingrun");
    await expect(page.getByRole("heading", { name: "My AI" })).toBeVisible();
  });

  test("discover model details resolve dotted ids and current vision model ids", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto("/app/discover");
    await page.locator(".model-card").filter({ hasText: "Qwen3.5-Plus" }).first().click();
    await expect(page).toHaveURL(/\/app\/discover\/models\/qwen3\.5-plus$/);
    await expect(page.getByRole("heading", { name: "Qwen3.5-Plus" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用此模型" })).toHaveCount(0);
    await expect(page.locator(".model-detail-status")).toContainText("可在助手页使用");
    await expect(page.locator('[aria-label="Breadcrumb"]').first()).toContainText("模型");
    await expect(page.getByRole("link", { name: "models" })).toHaveCount(0);

    await page.goto("/app/discover/models/qwen3-vl-plus");
    await expect(page.getByRole("heading", { name: "Qwen3-VL-Plus" })).toBeVisible();
    await expect(page.locator(".model-detail-provider")).toContainText("千问");
  });

  test("english discover and detail localize official labels", async ({ page }) => {
    await page.goto("/en/app/discover");
    await expect(page.locator(".discover-category-chip").filter({ hasText: "Text Generation" }).first()).toBeVisible();
    await expect(page.locator(".model-card-provider").first()).toContainText("Qwen");

    await page.locator(".model-card").filter({ hasText: "Qwen3.5-Plus" }).first().click();
    await expect(page).toHaveURL(/\/en\/app\/discover\/models\/qwen3\.5-plus$/);
    await expect(page.locator(".model-detail-tags .model-card-tag.highlight")).toContainText("Text Generation");
    await expect(page.locator(".model-detail-provider")).toContainText("Alibaba");
  });

  test("discover shows an error state when the official catalog request fails", async ({ page }) => {
    await page.route("**/api/v1/models/catalog?view=discover", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "broken" } }),
      });
    });

    await page.goto("/app/discover");
    await expect(page.getByText("加载官方模型目录失败。")).toBeVisible();
  });

  test("assistant detail route renders current action surface without 5xx responses", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const failingResponses: string[] = [];

    page.on("response", (response) => {
      const url = response.url();
      if (
        url.includes(`/app/assistants/${handle.seedProjectId}`) &&
        response.status() >= 500
      ) {
        failingResponses.push(`${response.status()} ${url}`);
      }
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await expect(page.getByRole("link", { name: "开始聊天" })).toBeVisible();
    await expect(
      page.locator(".assistant-profile-actions").getByRole("button", { name: "设置" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "管理" })).toBeVisible();
    expect(failingResponses).toEqual([]);
  });

  test("assistant dialogs stay inside the console theme container", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.locator(".assistant-profile-actions").getByRole("button", { name: "设置" }).click();

    const dialog = page.locator('[data-theme="console"] [role="dialog"]').first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("给它一个名字和形象");
  });

  test("assistant detail collapses covered vision model slots into the chat model", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);

    const visionRow = page.locator(".profile-model-row").filter({ hasText: "视觉理解" }).first();
    await expect(visionRow).toContainText("Qwen 3.5 Plus");
    await expect(visionRow).toContainText("跟随对话模型");
    await expect(visionRow).toContainText("图像输入会直接交给 Qwen 3.5 Plus");
    await expect(visionRow.getByRole("button", { name: "更换" })).toHaveCount(0);
  });

  test("assistant detail shows a dedicated realtime model row", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);

    const realtimeRow = page.locator(".profile-model-row").filter({ hasText: "实时对话" }).first();
    await expect(realtimeRow).toContainText("Qwen3-Omni-Flash-Realtime");
    await expect(realtimeRow).toContainText("实时双工语音当前使用 Qwen3-Omni-Flash-Realtime");
    await expect(realtimeRow.getByRole("button", { name: "更换" })).toHaveCount(1);
  });

  test("assistant detail opens a realtime-only model picker", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.locator(".profile-model-row").filter({ hasText: "实时对话" }).first().getByRole("button", { name: "更换" }).click();

    const modal = page.locator(".model-picker-card");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("实时对话");
    await expect(modal).toContainText("Qwen3-Omni-Flash-Realtime");
    await expect(modal).not.toContainText("Qwen 3.5 Plus");
  });

  test("assistant detail round-trips through the marketplace detail picker flow", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.locator(".profile-model-row").filter({ hasText: "对话模型" }).first().getByRole("button", { name: "更换" }).click();
    await page.getByRole("link", { name: "前往模型广场" }).click();

    await expect(page).toHaveURL(/\/app\/discover\?picker=1&category=llm/);
    await page.locator(".model-card").filter({ hasText: "Qwen Max" }).first().click();
    await expect(page.getByRole("heading", { name: "Qwen Max" })).toBeVisible();
    await expect(page.getByRole("link", { name: "返回上一页" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "使用此模型" })).toBeEnabled();
    await page.getByRole("button", { name: "使用此模型" }).click();

    await expect(page).toHaveURL(new RegExp(`/app/assistants/${handle.seedProjectId}$`));
    const llmRow = page.locator(".profile-model-row").filter({ hasText: "对话模型" }).first();
    await expect(llmRow).toContainText("Qwen Max");
  });

  test("assistant detail shows dedicated synthetic realtime model rows", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "模型" }).click();

    const syntheticSection = page
      .locator(".profile-mode-section-header")
      .filter({ hasText: "合成式实时" })
      .first()
      .locator("..");
    await expect(syntheticSection).toContainText("合成实时对话模型");
    await expect(syntheticSection).toContainText("实时语音识别");
    await expect(syntheticSection).toContainText("Qwen3-ASR-Flash-Realtime");
    await expect(syntheticSection).toContainText("实时语音合成");
    await expect(syntheticSection).toContainText("Qwen3-TTS-Flash-Realtime");
  });

  test("assistant detail saves the default chat mode", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const patchedBodies: Array<{ default_chat_mode?: string }> = [];

    await page.route(`**/api/v1/projects/${handle.seedProjectId}`, async (route) => {
      if (route.request().method().toUpperCase() !== "PATCH") {
        await route.fallback();
        return;
      }

      patchedBodies.push(route.request().postDataJSON() as { default_chat_mode?: string });
      await route.fallback();
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "模型" }).click();
    await page.locator(".profile-mode-card").filter({ hasText: "合成式实时" }).first().click();

    await expect.poll(() => patchedBodies.at(-1)?.default_chat_mode).toBe("synthetic_realtime");
    await expect(
      page.locator(".profile-mode-card.is-active").filter({ hasText: "合成式实时" }).first(),
    ).toBeVisible();
  });

  test("chat timeout errors stay localized", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route("**/api/v1/chat/conversations/*/messages", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "inference_timeout",
            message: "Inference timeout",
          },
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.getByRole("textbox", { name: "输入消息…" }).first()).toBeEnabled();

    await page.getByRole("textbox", { name: "输入消息…" }).fill("测试超时");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.locator(".chat-message.is-assistant").last()).toContainText(
      "AI 回复超时，请稍后重试。",
    );
  });

  test("chat message history loads through the app origin instead of cross-origin api calls", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let messageRequestUrl = "";

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conv-proxy",
            project_id: handle.seedProjectId,
            title: "代理会话",
            updated_at: "2026-03-18T08:00:00.000Z",
          },
        ]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-proxy/messages", async (route, request) => {
      messageRequestUrl = request.url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg-proxy-1",
            role: "user",
            content: "通过同源代理读取历史消息",
            created_at: "2026-03-18T08:00:00.000Z",
          },
        ]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}&conv=conv-proxy`);
    await expect(page.locator(".chat-message.is-user").first()).toContainText("通过同源代理读取历史消息");

    expect(new URL(messageRequestUrl).origin).toBe(new URL(page.url()).origin);
  });

  test("chat mic button dictates into the input instead of sending immediately", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let dictateCalls = 0;

    await stubBrowserVoiceApis(page);
    await page.route("**/api/v1/chat/conversations/*/dictate", async (route) => {
      dictateCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text_input: "帮我整理成一段话",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.locator(".chat-mic-btn").click();
    await expect(page.locator(".chat-voice-indicator")).toContainText("听写中…再次点击完成");

    await page.locator(".chat-mic-btn").click();

    await expect(page.getByRole("textbox", { name: "输入消息…" })).toHaveValue("帮我整理成一段话");
    expect(dictateCalls).toBe(1);
    await expect(page.locator(".chat-message.is-user")).toHaveCount(0);
  });

  test("assistant messages can be read aloud on demand", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const speechBodies: Array<{ content?: string }> = [];

    await stubBrowserVoiceApis(page);
    await page.route("**/api/v1/chat/conversations/*/speech", async (route) => {
      speechBodies.push(route.request().postDataJSON() as { content?: string });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          audio_response: "AQID",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.getByRole("textbox", { name: "输入消息…" }).fill("帮我回答");
    await page.getByRole("button", { name: "发送" }).click();

    const assistantMessage = page.locator(".chat-message.is-assistant").last();
    await expect(assistantMessage).toContainText("Mock assistant response");
    await assistantMessage.getByRole("button", { name: "朗读" }).click();

    await expect.poll(() => speechBodies.length).toBe(1);
    expect(speechBodies).toEqual([{ content: "Mock assistant response" }]);
  });

  test("deep think shows reasoning content and read aloud still uses the final answer", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const messageBodies: Array<{ content?: string; enable_thinking?: boolean }> = [];
    const speechBodies: Array<{ content?: string }> = [];

    await stubBrowserVoiceApis(page);
    await page.route("**/api/v1/chat/conversations/*/messages", async (route, request) => {
      if (request.method() === "POST") {
        messageBodies.push(request.postDataJSON() as { content?: string; enable_thinking?: boolean });
      }
      await route.fallback();
    });
    await page.route("**/api/v1/chat/conversations/*/speech", async (route) => {
      speechBodies.push(route.request().postDataJSON() as { content?: string });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          audio_response: "AQID",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.getByRole("button", { name: "深度思考" }).click();
    await page.getByRole("textbox", { name: "输入消息…" }).fill("请拆解一下");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => messageBodies.length).toBe(1);
    expect(messageBodies[0]).toEqual({ content: "请拆解一下", enable_thinking: true });

    const assistantMessage = page.locator(".chat-message.is-assistant").last();
    await expect(assistantMessage.locator(".chat-reasoning")).toContainText("思考过程");
    await expect(assistantMessage.locator(".chat-reasoning")).toContainText("Mock reasoning trace");
    await expect(assistantMessage.locator(".chat-bubble")).toContainText("Mock assistant response");

    await assistantMessage.getByRole("button", { name: "朗读" }).click();
    await expect.poll(() => speechBodies.length).toBe(1);
    expect(speechBodies[0]).toEqual({ content: "Mock assistant response" });
  });

  test("new assistant messages render with a typewriter cursor before settling", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.getByRole("textbox", { name: "输入消息…" }).fill("帮我起草");
    await page.getByRole("button", { name: "发送" }).click();

    const assistantMessage = page.locator(".chat-message.is-assistant").last();
    await expect(assistantMessage.locator(".chat-inline-cursor")).toBeVisible();
    await expect(assistantMessage.locator(".chat-bubble")).toContainText("Mock assistant response");
  });

  test("auto read requests speech for each new assistant reply", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const speechBodies: Array<{ content?: string }> = [];

    await stubBrowserVoiceApis(page);
    await page.route("**/api/v1/chat/conversations/*/speech", async (route) => {
      speechBodies.push(route.request().postDataJSON() as { content?: string });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          audio_response: "AQID",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.getByRole("button", { name: "自动朗读" }).click();
    await page.getByRole("textbox", { name: "输入消息…" }).fill("请自动朗读这段回复");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => speechBodies.length).toBe(1);
    expect(speechBodies[0]).toEqual({ content: "Mock assistant response" });
  });

  test("standard chat can send an image through the image pipeline", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let imageCalls = 0;

    await page.route("**/api/v1/chat/conversations/*/image", async (route) => {
      imageCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            id: "msg-image-1",
            role: "assistant",
            content: "Mock image response",
            created_at: "2026-03-18T08:00:00.000Z",
          },
          text_input: "请描述这张图片",
          audio_response: "AQID",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.getByRole("button", { name: "上传图片" })).toBeEnabled();
    await page.locator('[data-testid="chat-image-upload-input"]:not([disabled])').setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-image"),
    });

    await expect(page.locator(".chat-attachment-chip")).toContainText("demo.png");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => imageCalls).toBe(1);
    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("Mock image response");
  });

  test("chat mode overrides stay scoped to the current conversation", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conv-a",
            project_id: handle.seedProjectId,
            title: "会话 A",
            updated_at: "2026-03-18T08:00:00.000Z",
          },
          {
            id: "conv-b",
            project_id: handle.seedProjectId,
            title: "会话 B",
            updated_at: "2026-03-18T07:00:00.000Z",
          },
        ]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-a/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-b/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.getByRole("button", { name: "合成实时" }).click();
    await expect(page.getByRole("button", { name: "合成实时" })).toHaveClass(/is-active/);

    await page.locator(".chat-sidebar-item").filter({ hasText: "会话 B" }).click();
    await expect(page.getByRole("button", { name: "普通对话" })).toHaveClass(/is-active/);
  });

  test("chat history selection survives conversation list reloads", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    const conversations = [
      {
        id: "conv-empty",
        project_id: handle.seedProjectId,
        title: "空白会话",
        updated_at: "2026-03-18T08:00:00.000Z",
      },
      {
        id: "conv-history",
        project_id: handle.seedProjectId,
        title: "1天前",
        updated_at: "2026-03-17T08:00:00.000Z",
      },
    ];

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(conversations),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-empty/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-history/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg-1",
            role: "user",
            content: "历史问题",
            created_at: "2026-03-17T08:00:00.000Z",
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "历史回复",
            created_at: "2026-03-17T08:00:30.000Z",
          },
        ]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.locator(".chat-sidebar-item").nth(1).click();
    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("历史回复");

    await page.evaluate(() => {
      const select = document.querySelector(".chat-sidebar-header select") as HTMLSelectElement | null;
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(page.locator(".chat-message.is-assistant").last()).toContainText("历史回复");
  });

  test("assistant detail settings dialog saves edited identity", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let patchedProject:
      | {
          name?: string;
          description?: string;
        }
      | undefined;

    await page.route(`**/api/v1/projects/${handle.seedProjectId}`, async (route) => {
      if (route.request().method().toUpperCase() !== "PATCH") {
        await route.fallback();
        return;
      }

      patchedProject = route.request().postDataJSON() as {
        name?: string;
        description?: string;
      };
      await route.fallback();
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.locator(".assistant-profile-actions").getByRole("button", { name: "设置" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("助手名字").fill("更新后的助手");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "更新后的助手" })).toBeVisible();
    expect(patchedProject).toMatchObject({
      name: "更新后的助手",
    });
  });

  test("assistant detail model picker updates the visible llm name", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await expect(page.locator(".profile-model-name").first()).toHaveText("Qwen 3.5 Plus");

    await page.locator(".profile-model-change").first().click();
    await expect(page.locator(".model-picker-card")).toBeVisible();

    const qwenMaxCard = page.locator(".model-picker-item").filter({ hasText: "Qwen Max" }).first();
    await qwenMaxCard.locator(".marketplace-card-btn").click();

    await expect(page.locator(".profile-model-name").first()).toHaveText("Qwen Max");
  });

  test("assistant detail keeps the vision row visible in standard mode", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "模型" }).click();

    const visionRow = page.locator(".profile-model-row").filter({ hasText: "视觉理解" }).first();
    await expect(visionRow).toBeVisible();
    await expect(visionRow).toContainText("Qwen 3.5 Plus");
  });

  test("assistants page filters cards by the selected project", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method().toUpperCase() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "proj-seed",
              name: "Seed Console Project",
              description: "",
              created_at: "2026-03-14T12:00:00.000Z",
            },
            {
              id: "proj-test-a",
              name: "测试项目A",
              description: "",
              created_at: "2026-03-15T12:00:00.000Z",
            },
            {
              id: "proj-doctor",
              name: "医生",
              description: "",
              created_at: "2026-03-16T12:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.goto("/app/assistants");
    await page.locator(".inline-topbar-project-select").selectOption("proj-test-a");

    await expect(page.locator(".assistant-card-name")).toHaveCount(1);
    await expect(page.locator(".assistant-card-name").first()).toHaveText("测试项目A");
  });

  test("duplicate project names stay distinguishable in selectors", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method().toUpperCase() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "11111111-aaaa-4aaa-8aaa-111111111111",
              name: "测试项目A",
              description: "",
              created_at: "2026-03-14T12:00:00.000Z",
            },
            {
              id: "22222222-bbbb-4bbb-8bbb-222222222222",
              name: "测试项目A",
              description: "",
              created_at: "2026-03-15T12:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.goto("/app/assistants");
    await expect(page.locator(".inline-topbar-project-select")).toBeVisible();
    await expect(page.locator(".inline-topbar-project-select")).toContainText(
      "测试项目A (11111111)",
    );
    await expect(page.locator(".inline-topbar-project-select")).toContainText(
      "测试项目A (22222222)",
    );
  });

  test("memory graph stats reflect the filtered search results", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/memory?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: "memory-root",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "Seed Console Project",
              category: "assistant",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: null,
              position_x: 0,
              position_y: 0,
              metadata_json: {
                node_kind: "assistant-root",
                assistant_name: "Seed Console Project",
              },
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
            {
              id: "memory-1",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "心理咨询流程",
              category: "心理",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: "memory-root",
              position_x: 0,
              position_y: 0,
              metadata_json: {},
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
            {
              id: "memory-2",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "心理干预记录",
              category: "心理",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: "memory-root",
              position_x: 60,
              position_y: 40,
              metadata_json: {},
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
            {
              id: "memory-3",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "医生排班安排",
              category: "医生",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: "memory-root",
              position_x: -40,
              position_y: -30,
              metadata_json: {},
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
          ],
          edges: [],
        }),
      });
    });

    await page.goto(`/app/memory`);
    await page.getByPlaceholder("搜索记忆…").fill("心理");
    await expect(page.locator(".graph-controls-stats")).toContainText("共 2 个记忆");
  });

  test("memory page count excludes the assistant root memory node", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/memory?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: "memory-root",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "医生助手",
              category: "assistant",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: null,
              position_x: 0,
              position_y: 0,
              metadata_json: {
                node_kind: "assistant-root",
                assistant_name: "医生助手",
              },
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
            {
              id: "memory-1",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "用户偏好午后回访",
              category: "偏好",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: "memory-root",
              position_x: 32,
              position_y: 16,
              metadata_json: {},
              created_at: "2026-03-18T08:00:00.000Z",
              updated_at: "2026-03-18T08:00:00.000Z",
            },
          ],
          edges: [],
        }),
      });
    });

    await page.goto(`/app/memory`);
    await expect(page.locator(".memory-topbar-count")).toContainText("1");
    await page.getByRole("button", { name: "列表" }).click();
    await expect(page.locator(".memory-list-item")).toHaveCount(1);
    await expect(page.locator(".memory-list-item")).toContainText("用户偏好午后回访");
  });

  test("assistant detail breadcrumbs use the assistant name instead of a raw uuid", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });
    const projectId = "f555d613-aaaa-4a15-8fd5-100000000001";

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method().toUpperCase() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: projectId,
              name: "医生",
            },
          ],
        }),
      });
    });

    await page.goto(`/app/assistants/${projectId}`);
    await expect(page.locator(".inline-topbar-breadcrumb")).toContainText("医生");
    await expect(page.locator(".inline-topbar-breadcrumb")).not.toContainText("f555d613");
  });

  test("assistant knowledge manager stays localized in Chinese", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "管理" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("教它知识");
    await expect(dialog).toContainText("拖拽文件到此处，或点击选择文件");
    await expect(dialog).toContainText("支持 PDF、TXT、DOCX、MD 格式");
  });

  test("chat generic failures stay localized in Chinese", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route("**/api/v1/chat/conversations/*/messages", async (route) => {
      if (route.request().method().toUpperCase() !== "POST") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "unexpected_failure",
            message: "Sorry, something went wrong",
          },
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await page.locator(".chat-sidebar-new").click();
    await page.getByRole("textbox", { name: "输入消息…" }).fill("测试报错");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.locator(".chat-message.is-assistant").last()).toContainText(
      "抱歉，刚才出错了，请重试。",
    );
  });

  test("model marketplace detail buttons stay on one line", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto("/app");
    const hasNowrapRule = await page.evaluate(() => {
      return Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((rule) => {
            return (
              rule.cssText.includes(".marketplace-card-btn") &&
              rule.cssText.includes("white-space: nowrap")
            );
          });
        } catch {
          return false;
        }
      });
    });
    expect(hasNowrapRule).toBe(true);
  });

  test("chat sidebar falls back to a message summary when the conversation title is empty", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conv-summary",
            project_id: handle.seedProjectId,
            title: "",
            updated_at: "2026-03-17T08:00:00.000Z",
          },
        ]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-summary/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg-user",
            role: "user",
            content: "如何缓解焦虑和失眠？",
            created_at: "2026-03-17T08:00:00.000Z",
          },
          {
            id: "msg-assistant",
            role: "assistant",
            content: "可以先从睡眠节律和情绪记录开始。",
            created_at: "2026-03-17T08:01:00.000Z",
          },
        ]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.locator(".chat-sidebar-item-title").first()).toContainText("如何缓解焦虑和失眠");
    await expect(page.locator(".chat-sidebar-item-time").first()).toContainText(/\d+天前/);
  });

  test("chat auto-creates a ready conversation when the assistant has no history", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.locator(".chat-main .chat-empty").first()).toContainText(
      "新对话已创建，输入第一条消息开始测试",
    );
    const modeSwitcher = page.locator(".chat-mode-switcher").first();
    await expect(modeSwitcher.locator(".chat-mode-chip.is-active")).toContainText("普通对话");
    await expect(page.getByRole("textbox", { name: "输入消息…" })).toBeEnabled();
    await expect(page.locator(".chat-mic-btn").first()).toBeEnabled();
    await expect(page.locator(".rt-entry")).toHaveCount(0);
  });

  test("chat initializes mode from the assistant default mode", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/projects/${handle.seedProjectId}`, async (route) => {
      if (route.request().method().toUpperCase() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: handle.seedProjectId,
          name: "Seed Console Project",
          description: "Default workspace project",
          default_chat_mode: "synthetic_realtime",
          created_at: "2026-03-14T12:00:00.000Z",
        }),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    const modeSwitcher = page.locator(".chat-mode-switcher").first();
    await expect(modeSwitcher.locator(".chat-mode-chip.is-active")).toContainText("合成实时");
    await expect(page.locator(".chat-mic-btn")).toHaveCount(0);
    await expect(page.locator(".rt-entry")).toContainText("合成实时");
  });

  test("chat does not create a new conversation before existing history finishes loading", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let createConversationCalls = 0;

    await page.route("**/api/v1/chat/conversations", async (route, request) => {
      if (request.method() === "POST") {
        createConversationCalls += 1;
      }
      await route.fallback();
    });

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conv-existing",
            project_id: handle.seedProjectId,
            title: "保留的历史会话",
            updated_at: "2026-03-17T08:00:00.000Z",
          },
        ]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.locator(".chat-sidebar-item-title").first()).toContainText("保留的历史会话");
    expect(createConversationCalls).toBe(0);
  });

  test("chat mode switching does not create a new conversation", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let createConversationCalls = 0;

    await page.route("**/api/v1/chat/conversations", async (route, request) => {
      if (request.method() === "POST") {
        createConversationCalls += 1;
      }
      await route.fallback();
    });

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conv-existing-mode",
            project_id: handle.seedProjectId,
            title: "已有会话",
            updated_at: "2026-03-17T08:00:00.000Z",
          },
        ]),
      });
    });

    await page.route("**/api/v1/chat/conversations/conv-existing-mode/messages", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.locator(".chat-sidebar-item-title").first()).toContainText("已有会话");
    const modeSwitcher = page.locator(".chat-mode-switcher").first();

    await modeSwitcher.getByRole("button", { name: /Omni 实时/ }).click();
    await expect(modeSwitcher.locator(".chat-mode-chip.is-active")).toContainText("Omni 实时");

    await modeSwitcher.getByRole("button", { name: /合成实时/ }).click();
    await expect(modeSwitcher.locator(".chat-mode-chip.is-active")).toContainText("合成实时");

    await modeSwitcher.getByRole("button", { name: /普通对话/ }).click();
    await expect(modeSwitcher.locator(".chat-mode-chip.is-active")).toContainText("普通对话");
    expect(createConversationCalls).toBe(0);
  });

  test("memory graph controls stay visible after zooming out", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/memory?project_id=${handle.seedProjectId}`);
    await page.getByRole("button", { name: "缩小" }).click();

    await expect(page.locator(".graph-controls")).toBeVisible();
    await expect(page.locator(".graph-controls-stats")).toBeVisible();
    await expect(page.locator(".graph-controls-btn.is-add")).toBeVisible();
  });

  test("personality card shows a friendly placeholder when empty", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/projects/${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: handle.seedProjectId,
          name: "Seed Console Project",
          description: "",
          created_at: "2026-03-14T12:00:00.000Z",
        }),
      });
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    const personalityCard = page.locator(".profile-card").first();

    await expect(personalityCard).toContainText("暂未设定");
    await expect(personalityCard).not.toContainText("---");
  });

  test("session expiry shows a toast and redirects back to login", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/chat/conversations?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "unauthorized",
            message: "Unauthorized",
          },
        }),
      });
    });

    await page.goto("/app/chat");
    await expect(
      page.locator("[role='status']").filter({ hasText: "登录已过期" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fchat/);
  });
});
