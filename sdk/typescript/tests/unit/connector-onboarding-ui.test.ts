import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(join(process.cwd(), "examples/companion/web/assets/settings-center.js"), "utf8");

test("设置中心保留自定义插件审查与真实连接测试", () => {
  assert.match(source, /extensionFile/);
  assert.match(source, /api\/agent\/extension\/validate/);
  assert.match(source, /requiresExecutableConfirmation/);
  assert.match(source, /permissionExpansion/);
  assert.match(source, /api\/platform\/connector\/test/);
  assert.match(source, /api\/agent\/extension\/upgrade/);
  assert.match(source, /review\.installed/);
});

test("普通连接列表隐藏无接入流程的占位并保留失败的已装扩展", () => {
  const start = source.indexOf("  function renderConnections(");
  const end = source.indexOf("  function renderBundledPlugins(", start);
  assert.ok(start >= 0 && end > start);
  const list = { innerHTML: "" };
  const escapeHtml = (value: unknown) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  runInNewContext(
    source.slice(start, end) + `\nrenderConnections(connectors);`,
    {
      connectors: [
        { id: "local-files", name: "本地文件", provider: "built-in", state: "ready", purpose: "读取文件" },
        { id: "github-placeholder", name: "GitHub", provider: "extension", state: "not-installed", purpose: "代码" },
        { id: "mail-placeholder", name: "邮箱", provider: "extension", state: "available", purpose: "邮件" },
        { id: "installed-mail", name: "已安装邮箱", provider: "extension", extensionId: "mail.custom", state: "failed", purpose: "邮件" },
        { id: "installed-calendar", name: "已安装日历", provider: "extension", extensionId: "calendar.custom", state: "disconnected", purpose: "日历" },
      ],
      $: (selector: string) => {
        assert.equal(selector, "#connectionList");
        return list;
      },
      escapeHtml,
    },
  );

  assert.match(list.innerHTML, /本地文件/);
  assert.match(list.innerHTML, /data-test="local-files"/);
  assert.match(list.innerHTML, /已安装邮箱/);
  assert.match(list.innerHTML, /已安装日历/);
  assert.equal((list.innerHTML.match(/data-manage-extension/g) || []).length, 2);
  assert.doesNotMatch(list.innerHTML, /GitHub|邮箱[^<]*未安装|mail-placeholder/);
  assert.doesNotMatch(list.innerHTML, /导入连接器|data-install(?:\s|>)/);
});
