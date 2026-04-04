const fs = require("fs");
const path = require("path");
const { webkit } = require("../apps/web/node_modules/playwright");

const APP_ORIGIN = "http://127.0.0.1:3000";
const OUT_DIR = path.resolve(__dirname, "../output/playwright/chat-retry-webkit");

function json(body, status = 200) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    },
    body: JSON.stringify(body),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  await context.addCookies([
    {
      name: "access_token",
      value: "playwright-access-token",
      url: APP_ORIGIN,
    },
    {
      name: "auth_state",
      value: "1",
      url: APP_ORIGIN,
    },
    {
      name: "mingrun_workspace_id",
      value: "ws-playwright",
      url: APP_ORIGIN,
    },
  ]);

  const page = await context.newPage();
  const events = [];
  const counters = {
    projects: 0,
    conversations: 0,
  };

  page.on("console", (msg) => {
    events.push({
      kind: "console",
      type: msg.type(),
      text: msg.text(),
      pageUrl: page.url(),
    });
  });
  page.on("pageerror", (err) => {
    events.push({
      kind: "pageerror",
      text: String(err.stack || err),
      pageUrl: page.url(),
    });
  });

  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill(json({ csrf_token: "csrf-playwright-token" }));
  });

  await page.route("**/api/v1/projects", async (route) => {
    counters.projects += 1;
    if (counters.projects === 1) {
      await route.fulfill(json({ error: { message: "transient unavailable" } }, 503));
      return;
    }
    await route.fulfill(
      json({
        items: [
          {
            id: "proj-seed",
            name: "Seed Console Project",
          },
        ],
      }),
    );
  });

  await page.route("**/api/v1/projects/proj-seed", async (route) => {
    await route.fulfill(
      json({
        id: "proj-seed",
        name: "Seed Console Project",
        default_chat_mode: "standard",
      }),
    );
  });

  await page.route("**/api/v1/pipeline?project_id=proj-seed", async (route) => {
    await route.fulfill(json({ items: [] }));
  });

  await page.route("**/api/v1/models/catalog", async (route) => {
    await route.fulfill(json([]));
  });

  await page.route("**/api/v1/chat/conversations?project_id=proj-seed", async (route) => {
    counters.conversations += 1;
    if (counters.conversations === 1) {
      await route.fulfill(json({ error: { message: "transient unavailable" } }, 503));
      return;
    }
    await route.fulfill(
      json([
        {
          id: "conv-seed",
          project_id: "proj-seed",
          title: "Seeded Conversation",
          updated_at: "2026-04-02T03:00:00.000Z",
        },
      ]),
    );
  });

  await page.route("**/api/v1/chat/conversations/conv-seed/messages", async (route) => {
    await route.fulfill(
      json([
        {
          id: "msg-1",
          conversation_id: "conv-seed",
          role: "assistant",
          content: "Seeded reply from mock API",
          created_at: "2026-04-02T03:00:00.000Z",
        },
      ]),
    );
  });

  await page.route("**/api/v1/chat/conversations/conv-seed/events", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": APP_ORIGIN,
        "Access-Control-Allow-Credentials": "true",
      },
      body: "",
    });
  });

  const samples = [];
  const checkpoints = [0, 1000, 3000, 6000];

  await page.goto(`${APP_ORIGIN}/app/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  for (const ms of checkpoints) {
    if (ms) {
      await page.waitForTimeout(ms - checkpoints[checkpoints.indexOf(ms) - 1]);
    }

    const screenshot = `chat-retry-${ms}ms.png`;
    await page.screenshot({
      path: path.join(OUT_DIR, screenshot),
      fullPage: false,
    });

    const snapshot = await page.evaluate(() => {
      const text =
        document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 800) || "";
      return {
        url: window.location.href,
        text,
        projectSelectPresent: Boolean(
          document.querySelector(".inline-topbar-project-select"),
        ),
        conversationItems: document.querySelectorAll(".chat-sidebar-item").length,
        emptyText:
          document.querySelector(".chat-empty")?.textContent?.trim() || null,
      };
    });

    samples.push({ ms, screenshot, ...snapshot });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify({ counters, samples, events }, null, 2),
  );

  console.log(JSON.stringify({ counters, samples, events }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
