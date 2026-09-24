import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { WIDGET_CONTRACT, WIDGET_STATE_LIMIT_BYTES, WidgetStateStore, hasWidgetIntent, injectWidgetBridge } from "../../examples/companion/widgets.js";
import { selfCheckWidget } from "../../examples/companion/widget-selfcheck.js";
import { findChromiumExecutable } from "../../examples/companion/presentation-visual-review.js";

function tempDir(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "widgets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

test("构件意图：要有'做'的动作和构件词；否定句、只是提到不算", () => {
  for (const text of ["帮我做一个能勾选的冰岛行李清单", "弄个番茄钟", "给我一个房贷计算器", "做个小游戏给孩子玩", "生成一个每日打卡表"]) {
    assert.equal(hasWidgetIntent(text), true, text);
  }
  for (const text of ["这个计算器怎么用", "不要做成小工具，直接回答", "我在清单上勾选了三项", "今天天气怎么样"]) {
    assert.equal(hasWidgetIntent(text), false, text);
  }
});

test("构件约定写清：单文件、不联网、状态走 clownfishState、不用 localStorage 和弹窗", () => {
  assert.match(WIDGET_CONTRACT, /单文件/);
  assert.match(WIDGET_CONTRACT, /不联网/);
  assert.match(WIDGET_CONTRACT, /window\.clownfishState\.load\(\)/);
  assert.match(WIDGET_CONTRACT, /直接用 localStorage.*替它存在本机/);
  assert.match(WIDGET_CONTRACT, /不要用 alert、prompt、confirm/);
});

test("状态桥接插在 <head> 最前面；编号经过转义，不能借编号注入脚本", () => {
  const html = injectWidgetBridge("<!doctype html><html><head><title>x</title></head><body></body></html>", "art_1");
  assert.ok(html.indexOf("clownfishState") < html.indexOf("<title>"));
  assert.ok(injectWidgetBridge("<p>no head</p>", "a").startsWith("<script>"));
  const hostile = injectWidgetBridge("<head></head>", "</script><script>alert(1)</script>");
  assert.doesNotMatch(hostile, /<\/script><script>alert/);
});

test("状态存储：跨重启保留、超过 64 KB 拒绝、钉住去重且最新在前", (t) => {
  const file = join(tempDir(t), "widget-state.json");
  const store = new WidgetStateStore(file);
  store.set("a", { checked: ["护照"] });
  assert.deepEqual(new WidgetStateStore(file).get("a"), { checked: ["护照"] });
  assert.equal(store.get("missing"), null);
  assert.throws(() => store.set("a", "x".repeat(WIDGET_STATE_LIMIT_BYTES + 1)), /64 KB/);
  store.setPinned("a", true); store.setPinned("b", true); store.setPinned("a", true);
  assert.deepEqual(new WidgetStateStore(file).pinned(), ["a", "b"]);
  store.setPinned("a", false);
  assert.deepEqual(store.pinned(), ["b"]);
  writeFileSync(file, "{broken");
  assert.equal(new WidgetStateStore(file).get("a"), null, "文件坏了不影响打开构件");
});

test("交付前自测：本机没有浏览器时如实记为没做；有浏览器时能抓到脚本报错和外部资源", { timeout: 60_000 }, async (t) => {
  const dir = tempDir(t);
  const none = await selfCheckWidget(join(dir, "x.html"), { executable: null });
  assert.equal(none.status, "not-run");
  assert.match(none.detail, /没有找到 Edge 或 Chrome/);
  if (!findChromiumExecutable()) { t.diagnostic("本机没有 Chromium，跳过真实浏览器部分"); return; }
  const good = join(dir, "good.html");
  writeFileSync(good, `<!doctype html><html><body><label><input type=checkbox id=a> 护照</label><script>window.clownfishState.load().then(()=>{document.getElementById('a').onchange=e=>window.clownfishState.save({a:e.target.checked})})</script></body></html>`);
  const passed = await selfCheckWidget(good);
  assert.equal(passed.status, "passed", passed.detail);
  assert.equal(passed.clicked, 1);
  const bad = join(dir, "bad.html");
  writeFileSync(bad, `<!doctype html><html><head><link rel=stylesheet href="https://cdn.example.com/x.css"></head><body><button onclick="missing()">点</button></body></html>`);
  const failed = await selfCheckWidget(bad);
  assert.equal(failed.status, "failed");
  assert.match(failed.detail, /外部资源/);
  assert.match(failed.detail, /missing is not defined/);
  // 页面用 confirm() 时无头浏览器会卡住：自测要自动点确定并记下来，不能超时。
  const modal = join(dir, "modal.html");
  writeFileSync(modal, `<!doctype html><html><body><button onclick="if(confirm('清空？'))localStorage.clear()">重置</button><script>localStorage.setItem('k','1')</script></body></html>`);
  const withDialog = await selfCheckWidget(modal);
  assert.equal(withDialog.status, "passed", withDialog.detail);
  assert.match(withDialog.detail, /弹了 1 次确认框/);
});

test("HTML 交付拆分：页面只要代码块，说明文字留给回复；没写到 </html> 记为没写完", async () => {
  const { splitHtmlDeliverable } = await import("../../examples/companion/capabilities.js");
  const fenced = splitHtmlDeliverable("清单做好了，直接勾。\n\n```html\n<!DOCTYPE html>\n<html><body><input type=checkbox></body></html>\n```\n\n交付完成。")!;
  assert.match(fenced.html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(fenced.html, /```|清单做好了/);
  assert.equal(fenced.prose, "清单做好了，直接勾。");
  assert.equal(fenced.complete, true);
  const cut = splitHtmlDeliverable("好的\n```html\n<!doctype html><html><body><ul><li>雨刷确认")!;
  assert.equal(cut.complete, false);
  const bare = splitHtmlDeliverable("<!doctype html><html><body>x</body></html>")!;
  assert.deepEqual([bare.prose, bare.complete], ["", true]);
  assert.equal(splitHtmlDeliverable("没有页面的回答"), null);
});
