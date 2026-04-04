import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRenderableMarkdown } from "../components/console/chat-markdown-normalization.ts";

test("normalizes CRLF line endings for markdown rendering", () => {
  const normalized = normalizeRenderableMarkdown("第一行\r\n第二行\r第三行");
  assert.equal(normalized, "第一行\n第二行\n第三行");
});

test("leaves already normalized markdown untouched", () => {
  const source = "## 标题\n\n- 项目一\n- 项目二";
  assert.equal(normalizeRenderableMarkdown(source), source);
});

test("merges emoji section labels and dangling colon bodies for rendering", () => {
  const source = [
    "下午好，董明阳！",
    "🍵",
    "深淬理论",
    "：继续把狄拉克方程的能量变换，享受推导的快感？",
    "🌳",
    "校园漫步",
    "：去海德公园（Hyde Park），或者南肯辛顿的博物馆区转转，寻找灵感？",
    "💡",
    "创意发散",
    "：聊聊怎么把下午茶的悠闲和量子力学的烧脑结合起来？",
  ].join("\n");

  assert.equal(
    normalizeRenderableMarkdown(source),
    [
      "下午好，董明阳！",
      "🍵 深淬理论：继续把狄拉克方程的能量变换，享受推导的快感？",
      "🌳 校园漫步：去海德公园（Hyde Park），或者南肯辛顿的博物馆区转转，寻找灵感？",
      "💡 创意发散：聊聊怎么把下午茶的悠闲和量子力学的烧脑结合起来？",
    ].join("\n"),
  );
});

test("merges short follow-up fragments into the previous renderable line", () => {
  const source = [
    "脑洞",
    "： 这不仅仅是地图，这是一个巨大的",
    "拓扑网络",
    "！ 环线（CircleLine）是不是像一个完美的闭合轨道？",
  ].join("\n");

  assert.equal(
    normalizeRenderableMarkdown(source),
    "脑洞： 这不仅仅是地图，这是一个巨大的拓扑网络！环线（CircleLine）是不是像一个完美的闭合轨道？",
  );
});
