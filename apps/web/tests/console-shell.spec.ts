import { expect, test } from "@playwright/test";
import { installWorkbenchApiMock } from "./helpers/mockWorkbenchApi";

test.use({ locale: "zh-CN" });

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
    await expect(page.locator(".icon-bar")).toBeVisible();
  });

  test("IconBar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.locator(".icon-bar")).not.toBeVisible();
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
    await page.click(".icon-bar-item[aria-label='知识库']");
    await expect(page).toHaveURL(/\/app\/knowledge$/);
    await expect(page.locator("#knowledge-name")).toBeVisible();
  });

  test("models icon remains clickable after hover on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app/assistants");
    const modelsIcon = page.locator(".icon-bar-item[aria-label='模型广场']");
    await modelsIcon.hover();
    const box = await modelsIcon.boundingBox();
    if (!box) {
      throw new Error("Expected models icon to have a bounding box");
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/app\/models$/);
    await expect(page.getByRole("heading", { name: "模型广场" })).toBeVisible();
  });

  test("models icon bypasses client-side router navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      const sessionKey = "playwright:nav-events";
      const pushEvents = JSON.parse(window.sessionStorage.getItem(sessionKey) || "[]");
      window.sessionStorage.setItem(sessionKey, JSON.stringify(pushEvents));

      const originalPushState = window.history.pushState.bind(window.history);
      window.history.pushState = function (...args) {
        const nextEvents = JSON.parse(window.sessionStorage.getItem(sessionKey) || "[]");
        nextEvents.push(String(args[2] || ""));
        window.sessionStorage.setItem(sessionKey, JSON.stringify(nextEvents));
        return originalPushState(...args);
      };
    });

    await page.goto("/app/assistants");
    const modelsIcon = page.locator(".icon-bar-item[aria-label='模型广场']");
    const box = await modelsIcon.boundingBox();
    if (!box) {
      throw new Error("Expected models icon to have a bounding box");
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/app\/models$/);

    const pushEvents = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem("playwright:nav-events") || "[]"),
    );
    expect(pushEvents).toEqual([]);
  });

  test("models page stays mounted when catalog data is partial", async ({ page }) => {
    await installWorkbenchApiMock(page, { authenticated: true });

    await page.route("**/api/v1/models/catalog", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            model_id: "qwen3.5-plus",
            display_name: "Qwen3.5-Plus",
            capabilities: ["chat", "vision"],
          },
        ]),
      });
    });

    await page.goto("/app/models");
    await expect(page.getByRole("heading", { name: "模型广场" })).toBeVisible();
    await expect(page.locator(".marketplace-card-name")).toContainText("Qwen3.5-Plus");
  });

  test("english console shell also renders correctly", async ({ page }) => {
    await page.goto("/en/app");
    await expect(page.locator("header.site-header-v2.is-console")).toContainText("Mingrun");
    await expect(page.getByRole("heading", { name: "My AI" })).toBeVisible();
  });

  test("assistant detail route renders without assistant page 5xx responses", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "🕸 记忆图谱" })).toBeVisible();
    await expect(page.getByRole("link", { name: "试用对话" })).toBeVisible();
    expect(failingResponses).toEqual([]);
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
    await expect(page.locator(".chat-sidebar-new")).toBeEnabled();
    await page.locator(".chat-sidebar-new").click();
    await expect(page.locator(".chat-input-bar-voice input")).toBeEnabled();

    await page.getByRole("textbox", { name: "输入消息…" }).fill("测试超时");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.locator(".chat-message.is-assistant").last()).toContainText(
      "AI 回复超时，请稍后重试。",
    );
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

  test("memory graph add button opens a form dialog with content and category", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });
    let postedMemory:
      | {
          project_id?: string;
          content?: string;
          category?: string;
        }
      | undefined;

    await page.route("**/api/v1/memory", async (route) => {
      if (route.request().method().toUpperCase() !== "POST") {
        await route.fallback();
        return;
      }

      postedMemory = route.request().postDataJSON() as {
        project_id?: string;
        content?: string;
        category?: string;
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "memory-created",
          workspace_id: handle.workspaceId,
          project_id: handle.seedProjectId,
          content: postedMemory?.content || "",
          category: postedMemory?.category || "",
          type: "permanent",
          source_conversation_id: null,
          parent_memory_id: null,
          position_x: null,
          position_y: null,
          metadata_json: {},
          created_at: "2026-03-18T12:00:00.000Z",
          updated_at: "2026-03-18T12:00:00.000Z",
        }),
      });
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "+ 添加记忆" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("内容").fill("新的测试记忆");
    await page.getByLabel("分类").fill("测试分类");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(postedMemory).toEqual({
      project_id: handle.seedProjectId,
      content: "新的测试记忆",
      category: "测试分类",
    });
  });

  test("assistant config shows the selected base model display name", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "⚙️ 配置" }).click();

    await expect(page.locator(".canvas-model-name")).toHaveText("Qwen3.5-Plus");
    await expect(page.locator(".canvas-model-name")).not.toHaveText("---");
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
              id: "memory-1",
              workspace_id: handle.workspaceId,
              project_id: handle.seedProjectId,
              content: "心理咨询流程",
              category: "心理",
              type: "permanent",
              source_conversation_id: null,
              parent_memory_id: null,
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
              parent_memory_id: null,
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
              parent_memory_id: null,
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

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByPlaceholder("搜索记忆…").fill("心理");
    await expect(page.locator(".graph-controls-stats")).toContainText("共 2 个记忆");
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

  test("assistant config advanced labels stay localized in Chinese", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.route(`**/api/v1/datasets?project_id=${handle.seedProjectId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "dataset-psychology",
            project_id: handle.seedProjectId,
            name: "心理资料",
            item_count: 0,
          },
        ]),
      });
    });

    await page.goto(`/app/assistants/${handle.seedProjectId}`);
    await page.getByRole("button", { name: "⚙️ 配置" }).click();

    const knowledgeCard = page.locator(".canvas-card").filter({
      has: page.locator(".canvas-card-label", { hasText: "知识库" }),
    }).first();
    const personalityCard = page.locator(".canvas-card").filter({
      has: page.locator(".canvas-card-label", { hasText: "人格设定" }),
    }).first();

    await knowledgeCard.getByRole("button", { name: "展开高级选项" }).click();
    await personalityCard.getByRole("button", { name: "展开高级选项" }).click();

    await expect(knowledgeCard).toContainText("0 条资料");
    await expect(personalityCard).toContainText("系统提示词");
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
    await expect(page.locator(".chat-sidebar-item-time").first()).toContainText("1天前");
  });

  test("new conversation shows a ready state in the chat panel", async ({ page }) => {
    const handle = await installWorkbenchApiMock(page, { authenticated: true });

    await page.goto(`/app/chat?project_id=${handle.seedProjectId}`);
    await expect(page.locator(".chat-empty")).toContainText("选择一个 AI 助手，开始对话测试");

    await page.locator(".chat-sidebar-new").click();

    await expect(page.locator(".chat-empty")).toContainText(
      "新对话已创建，输入第一条消息开始测试",
    );
    await expect(page.getByRole("textbox", { name: "输入消息…" })).toBeEnabled();
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
    await page.getByRole("button", { name: "⚙️ 配置" }).click();

    const personalityCard = page.locator(".canvas-card").filter({
      has: page.locator(".canvas-card-label", { hasText: "人格设定" }),
    }).first();

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
