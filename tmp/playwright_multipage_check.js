const fs = require("fs");
const path = require("path");
const { webkit } = require("../apps/web/node_modules/playwright");

async function collectSample(page, label, outDir, samples) {
  for (const ms of [0, 300, 1000, 2500]) {
    if (ms) {
      await page.waitForTimeout(ms);
    }

    const data = await page.evaluate(() => {
      const text =
        document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 600) || "";
      const heroBody = document.querySelector(".hero-body");
      const heroImage = document.querySelector(".hero-image");
      const animated = Array.from(
        document.querySelectorAll(
          ".highlight-card, .eco-text, .eco-visual, .cta-title, .cta-body, .craft-copy",
        ),
      ).slice(0, 10);
      const styleOf = (el) => (el ? getComputedStyle(el) : null);

      return {
        title: document.title,
        text,
        heroBody: heroBody
          ? {
              opacity: styleOf(heroBody).opacity,
              visibility: styleOf(heroBody).visibility,
              transform: styleOf(heroBody).transform,
            }
          : null,
        heroImage: heroImage
          ? {
              opacity: styleOf(heroImage).opacity,
              visibility: styleOf(heroImage).visibility,
              transform: styleOf(heroImage).transform,
            }
          : null,
        animated: animated.map((el) => ({
          className: String(el.className),
          text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 80),
          opacity: styleOf(el).opacity,
          visibility: styleOf(el).visibility,
          transform: styleOf(el).transform,
        })),
      };
    });

    const screenshot = `${label}-${ms}ms.png`;
    await page.screenshot({
      path: path.join(outDir, screenshot),
      fullPage: false,
    });

    samples.push({
      label,
      ms,
      url: page.url(),
      screenshot,
      ...data,
    });
  }
}

async function main() {
  const outDir = path.resolve(__dirname, "../output/playwright/multipage-webkit");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });

  const events = [];
  const samples = [];

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

  const flows = [
    { label: "home", url: "http://127.0.0.1:3000/" },
    { label: "product", clickName: "产品" },
    { label: "ecosystem", clickName: "生态" },
    { label: "support", clickName: "支持" },
    { label: "demo", clickName: "体验" },
  ];

  await page.goto(flows[0].url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await collectSample(page, flows[0].label, outDir, samples);

  for (const flow of flows.slice(1)) {
    await page.getByRole("link", { name: flow.clickName }).first().click({
      timeout: 10000,
    });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await collectSample(page, flow.label, outDir, samples);
  }

  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify({ samples, events }, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        sampleCount: samples.length,
        eventCount: events.length,
        lastUrl: page.url(),
        notableEvents: events.slice(0, 50),
        sampleSummary: samples.map((sample) => ({
          label: sample.label,
          ms: sample.ms,
          url: sample.url,
          title: sample.title,
          text: sample.text.slice(0, 120),
          heroBodyOpacity: sample.heroBody?.opacity,
          heroImageOpacity: sample.heroImage?.opacity,
          animated: sample.animated.slice(0, 3),
        })),
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
