const fs = require("fs");
const path = require("path");
const { webkit } = require("../apps/web/node_modules/playwright");

async function main() {
  const outDir = path.resolve(__dirname, "../output/playwright/chat-idle-webkit");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });

  const events = [];
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
  page.on("response", (res) => {
    if (res.status() >= 400) {
      events.push({
        kind: "badResponse",
        status: res.status(),
        url: res.url(),
        pageUrl: page.url(),
      });
    }
  });
  page.on("requestfailed", (req) => {
    events.push({
      kind: "requestfailed",
      url: req.url(),
      error: req.failure()?.errorText,
      pageUrl: page.url(),
    });
  });

  await page.goto("http://127.0.0.1:3000/app/chat", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const checkpoints = [0, 5000, 15000, 30000, 60000, 90000];
  const samples = [];

  for (const ms of checkpoints) {
    if (ms) {
      await page.waitForTimeout(ms - checkpoints[checkpoints.indexOf(ms) - 1]);
    }

    const sample = await page.evaluate(() => {
      const bodyText =
        document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 1200) || "";
      const root = document.querySelector("main");
      const aside = document.querySelector("aside");
      const appShell = document.querySelector("[data-app-shell]");
      const sidebar = document.querySelector("[data-sidebar]");
      const chatInput =
        document.querySelector("textarea") ||
        document.querySelector("input[placeholder]") ||
        document.querySelector("[contenteditable='true']");

      return {
        title: document.title,
        bodyText,
        location: window.location.href,
        mainChildCount: root?.children.length ?? null,
        mainHtmlLength: root?.innerHTML.length ?? null,
        asideHtmlLength: aside?.innerHTML.length ?? null,
        appShellHtmlLength: appShell?.innerHTML.length ?? null,
        sidebarHtmlLength: sidebar?.innerHTML.length ?? null,
        chatInputPresent: Boolean(chatInput),
        loadingCount: document.querySelectorAll('[aria-busy="true"], .loading, [data-loading]').length,
      };
    });

    const screenshot = `chat-${ms}ms.png`;
    await page.screenshot({
      path: path.join(outDir, screenshot),
      fullPage: false,
    });

    samples.push({
      ms,
      screenshot,
      ...sample,
    });
  }

  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify({ samples, events }, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        samples,
        events: events.slice(0, 100),
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
