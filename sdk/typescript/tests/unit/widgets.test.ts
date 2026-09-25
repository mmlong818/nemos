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
  // 真实使用里模型两次都写"保存为 .html 双击打开"：页面其实就嵌在回复里用，这样说会把人引去下载。
  assert.match(WIDGET_CONTRACT, /直接嵌在这条回复里/);
  assert.match(WIDGET_CONTRACT, /不要让用户下载、另存或双击打开/);
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
  // 点"重置"时页面自己刷新：不能算没做自测，要写明刷新了。
  const reload = join(dir, "reload.html");
  writeFileSync(reload, `<!doctype html><html><body><button onclick="location.reload()">重置</button><p>清单</p></body></html>`);
  const reloaded = await selfCheckWidget(reload);
  assert.equal(reloaded.status, "passed", reloaded.detail);
  assert.match(reloaded.detail, /页面刷新或跳转了一次/);
  // 自测要和线上同一个沙箱：直接开本地文件时是有来源的页面，沙箱里才会坏的写法自测看不出来。
  const origin = join(dir, "origin.html");
  // file:// 的 origin 本来就是 "null"，分不出来；只有缺 allow-same-origin 的沙箱里读 cookie 才会抛错。
  writeFileSync(origin, `<!doctype html><html><body><p>清单</p><script>let sandboxed = false; try { document.cookie } catch { sandboxed = true } if (!sandboxed) throw new Error("不在沙箱里")</script></body></html>`);
  const sandboxed = await selfCheckWidget(origin);
  assert.equal(sandboxed.status, "passed", sandboxed.detail);
  // 真实使用里"加一条"是最常见的写法：表单提交在沙箱里要能触发 submit，自测要先填好输入框再点。
  const form = join(dir, "form.html");
  writeFileSync(form, `<!doctype html><html><body><form id=f><input required id=t placeholder="加一条"><button type=submit>添加</button></form><ul id=l></ul><script>document.getElementById('f').onsubmit=(e)=>{e.preventDefault();addedItem(document.getElementById('t').value)}</script></body></html>`);
  const submitted = await selfCheckWidget(form);
  assert.equal(submitted.status, "failed", "submit 没触发时 addedItem 不会被调用，自测就会误报通过");
  assert.match(submitted.detail, /addedItem is not defined/);
  // 真实使用里番茄钟到点 alert()：在嵌入框里会弹出盖住整个应用的模态框。桥接把它换成页面内的提示条。
  const alerting = join(dir, "alert.html");
  writeFileSync(alerting, `<!doctype html><html><body><button onclick="alert('一个番茄完成'); if (!document.querySelector('[role=status]')) throw new Error('没有页面内提示')">完成</button></body></html>`);
  const toasted = await selfCheckWidget(alerting);
  assert.equal(toasted.status, "passed", toasted.detail);
  assert.doesNotMatch(toasted.detail, /确认框/, "alert 不再是浏览器弹框");
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

// 真实使用发现：构件回复开头是"X已经完成「用户原话」"、结尾贴本机路径，自测结论挤进上面的列表里，
// 摘要（总览"最近的成果"用）还夹着 <!DOCTYPE html>。
test("HTML 交付的回复与摘要：不带模板开头和本机路径，自测单独成段，摘要只取说明文字", async () => {
  const { deliveryText, deliverableSummary } = await import("../../examples/companion/capabilities.js");
  const raw = "清单做好了，直接勾。\n\n```html\n<!DOCTYPE html>\n<html><head><title>周末清单</title></head><body><input type=checkbox></body></html>\n```\n\n说明：\n- 数据只存本机";
  const html = { format: "html" as const, file: "C:/data/artifacts/做一个清单-art-1.html", summary: "", metadata: { validationChecks: [{ id: "browser-self-check", label: "自测", status: "passed" as const, detail: "点了 3 个控件，没有脚本报错" }] } };
  const text = deliveryText("小丑鱼", "做一个能勾选的清单", html, raw);
  assert.doesNotMatch(text, /已经完成「|保存位置|产物格式|<html|```/);
  assert.match(text, /^清单做好了，直接勾。/);
  assert.match(text, /- 数据只存本机\n\n自测：点了 3 个控件，没有脚本报错$/);
  const summary = deliverableSummary(raw, "html");
  assert.doesNotMatch(summary, /<|```/);
  assert.match(summary, /^清单做好了，直接勾。/);
  // 其他格式的交付不在聊天里嵌入，保留原来的说明和保存位置。
  const doc = { format: "md" as const, file: "C:/data/artifacts/报告.md", summary: "", metadata: {} };
  const report = deliveryText("小丑鱼", "写一份周报", doc, "# 周报\n本周完成三件事");
  assert.match(report, /^小丑鱼已经完成「写一份周报」。/);
  assert.match(report, /保存位置：C:\/data\/artifacts\/报告\.md$/);
  assert.equal(deliverableSummary("# 周报\n本周完成三件事", "md"), "周报\n本周完成三件事");
});
