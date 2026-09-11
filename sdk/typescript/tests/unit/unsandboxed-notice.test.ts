import assert from "node:assert/strict";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { bundledCapabilityPluginCatalog, spawnsUnsandboxedProcess } from "../../examples/companion/bundled-capability-plugins.js";
import { requiresUnsandboxedExecutionApproval } from "../../src/agent/extensions.js";

const server = readServerRouteSurface();
const packageRoot = process.cwd();

// 硬编码豁免的问题不是"没有确认"——安装本来就要 confirmExecutable；
// 问题是代码按插件 id 决定了 allowUnsandboxed，而确认文案没说这件事。
test("无沙箱执行不再按插件 id 豁免，而是由这次请求的用户确认决定", () => {
  assert.equal(server.includes('allowUnsandboxed: item.manifest.id === "browser.playwright"'), false,
    "不应再按插件 id 硬编码豁免");
  assert.match(server, /allowUnsandboxed: needsUnsandboxed && body\.confirmExecutable === true/);
  assert.match(server, /const needsUnsandboxed = spawnsUnsandboxedProcess\(item\.manifest\)/);
});

test("安装确认文案说清「不在沙箱内运行」及其后果", () => {
  const start = server.indexOf("const needsUnsandboxed");
  const gate = server.slice(start, server.indexOf("agentUserActions.execute", start));
  assert.match(gate, /不在扩展沙箱内运行/);
  assert.match(gate, /不受读写路径与网络策略限制/);
  assert.match(gate, /unsandboxed: true/);
  // 原来的文案只提"隔离的 Chrome 进程"，那是在描述浏览器的隔离，不是扩展的沙箱。
  assert.equal(gate.includes("浏览器操作会启动隔离的 Chrome 进程，需要明确确认。"), false);
});

// SDK 的 requiresUnsandboxedExecutionApproval 带一条 source.type !== "builtin" 总闸，
// 对四个内置插件一律返回 false——拿它把门，门永远不会关。这条钉住我们不再用它。
test("内置身份不能顺带免掉无沙箱确认", () => {
  const catalog = bundledCapabilityPluginCatalog({ packageRoot });
  assert.equal(catalog.every((item) => requiresUnsandboxedExecutionApproval(item.manifest) === false), true,
    "SDK 判定对内置插件全部返回 false，因此不能用它把安装确认门");

  const needing = catalog.filter((item) => spawnsUnsandboxedProcess(item.manifest));
  assert.deepEqual(needing.map((item) => item.id), ["browser.playwright"]);
  // 其余三个是模块或连接器，不启动本机进程，不该被提示打扰。
  assert.equal(catalog.length - needing.length, 3);
});

test("启动提示按扩展 id 加版本记录确认，升版后重新提示", () => {
  const fn = server.slice(server.indexOf("function unsandboxedNotice("), server.indexOf("function readJsonFile<"));
  assert.match(fn, /\$\{item\.id\}@\$\{item\.version\}/, "确认键必须含版本");
  assert.match(fn, /extension\.enabled && spawnsUnsandboxedProcess/, "只提示启用中的无沙箱扩展");
  assert.match(fn, /if \(!items\.length\) return \{ items, acknowledged: true \}/, "没有这类扩展时不提示");
  // 读不出确认记录时按"未确认"处理：多提示一次可接受，漏提示不可接受。
  const start = server.indexOf("function readJsonFile<");
  const reader = server.slice(start, start + 600);
  assert.match(reader, /catch \{[\s\S]*?return fallback;/);
});

test("确认端点只写当前在运行的那些扩展版本", () => {
  // 按路由声明定位，以下一条 route( 为界——处理函数换文件时这个切法仍然成立。
  const start = server.indexOf('route("POST", "/api/unsandboxed-notice/acknowledge"');
  assert.notEqual(start, -1, "找不到确认端点的路由声明");
  const next = server.indexOf('route("', start + 10);
  const handler = server.slice(start, next === -1 ? undefined : next);
  assert.match(handler, /unsandboxedNotice\(\)/, "确认的对象来自当前实际状态，不来自请求体");
  assert.equal(handler.includes("readBody"), false, "请求体不参与决定确认了什么");
  assert.match(handler, /\.tmp/, "先写临时文件再改名");
});

// —— 启动提示的界面部分 ——
// 接口做好但界面没接，等于这个提示对用户不存在。这一组盯住界面确实存在且行为正确。

const noticeScript = readFileSync("examples/companion/web/assets/unsandboxed-notice.js", "utf8");
const notice = (() => {
  const sandbox: { window: Record<string, unknown>; document?: unknown } = { window: {} };
  runInNewContext(noticeScript, sandbox);
  return sandbox.window.ClownfishUnsandboxedNotice as {
    shouldShow: (payload: unknown) => boolean;
    noticeHtml: (items: Array<{ id: string; name: string; version: string }>) => string;
  };
})();

test("每个页面都挂了启动提示脚本", () => {
  const pages = readdirSync("examples/companion/web").filter((name) => name.endsWith(".html"));
  assert.ok(pages.length >= 8, "页面数看起来不对");
  for (const page of pages) {
    assert.match(
      readFileSync(join("examples/companion/web", page), "utf8"),
      /assets\/unsandboxed-notice\.js/,
      `${page} 没有挂启动提示脚本——新增页面会静默漏掉这条提示`,
    );
  }
});

test("没有这类扩展、或本版本已确认过，就完全不渲染", () => {
  assert.equal(notice.shouldShow(undefined), false);
  assert.equal(notice.shouldShow({ items: [] }), false);
  assert.equal(notice.shouldShow({ items: [{ id: "a", name: "A", version: "1" }], acknowledged: true }), false);
  assert.equal(notice.shouldShow({ items: [{ id: "a", name: "A", version: "1" }], acknowledged: false }), true);
});

test("横幅说清后果、转义扩展名称、并带确认按钮", () => {
  const html = notice.noticeHtml([{ id: "browser.playwright", name: "浏览器操作", version: "1.0.0" }]);
  assert.match(html, /在扩展沙箱之外运行/);
  // 只说"不在沙箱里"没有信息量；必须说清它因此能做什么。
  assert.match(html, /不受读写路径与网络策略限制/);
  assert.match(html, /1\.0\.0/, "要显示版本——升版会重新提示，用户得能对上");
  assert.match(html, /data-cf-unsandboxed-ack/);

  const hostile = notice.noticeHtml([{ id: "x", name: '<img src=x onerror=alert(1)>', version: '"><b>' }]);
  assert.ok(!hostile.includes("<img"), "扩展名称必须转义");
  assert.ok(!hostile.includes("<b>"), "版本号也必须转义");
});

test("确认失败也不把横幅留下：先移除再上报", () => {
  const ackIndex = noticeScript.indexOf("banner.remove()");
  const postIndex = noticeScript.indexOf("/acknowledge");
  assert.ok(ackIndex > 0 && postIndex > ackIndex, "移除横幅应当发生在上报之前");
  assert.match(noticeScript, /catch \{[^}]*\}/, "上报失败要被吞掉，下次启动再提示");
});
