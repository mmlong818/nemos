import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { ARTIFACT_SANDBOX_HEADERS } from "../../examples/companion/capabilities.js";
import { isAllowedLocalRequest } from "../../examples/companion/local-http-security.js";

// 产物页和应用接口同源：不加沙箱时，模型写的脚本能以用户身份调 /api/*（曾经如此）。
test("产物页的沙箱：能跑脚本，但没有同源身份、不能向外发请求", () => {
  const csp = ARTIFACT_SANDBOX_HEADERS["Content-Security-Policy"];
  const sandbox = csp.split(";")[0].trim().split(/\s+/);
  assert.equal(sandbox[0], "sandbox");
  assert.ok(sandbox.includes("allow-scripts"), "构件要能运行脚本");
  assert.ok(!sandbox.includes("allow-same-origin"), "不能拿到应用的同源身份");
  assert.ok(!sandbox.includes("allow-top-navigation"), "不能把整个应用页面导走");
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.equal(ARTIFACT_SANDBOX_HEADERS["X-Content-Type-Options"], "nosniff");
});

// 构件最常见的"加一条"是 <form onsubmit>：沙箱缺 allow-forms 时浏览器连 submit 事件都不发，按钮点了没反应。
// 放开 allow-forms 仍安全：form-action 'none' 让表单数据发不出去，提交只剩页面自己的脚本处理。
test("产物页允许表单提交事件，但表单数据发不出去；嵌入框与响应头的沙箱一致", () => {
  const csp = ARTIFACT_SANDBOX_HEADERS["Content-Security-Policy"];
  const flags = csp.split(";")[0].trim().split(/\s+/).slice(1);
  assert.ok(flags.includes("allow-forms"));
  assert.match(csp, /form-action 'none'/);
  const host = readFileSync("examples/companion/web/assets/widget-host.js", "utf8");
  const attr = /setAttribute\("sandbox", "([^"]+)"\)/.exec(host);
  assert.ok(attr, "widget-host.js 里要有 iframe 的 sandbox 属性");
  assert.deepEqual(attr[1].split(/\s+/).sort(), [...flags].sort());
});

test("沙箱里的页面发往 /api 的请求带 Origin: null，本机同源检查拒绝", () => {
  const base = { remoteAddress: "127.0.0.1", host: "127.0.0.1:8787", port: 8787 };
  assert.equal(isAllowedLocalRequest({ ...base, origin: "http://127.0.0.1:8787" }), true, "应用自己的页面照常可用");
  assert.equal(isAllowedLocalRequest({ ...base, origin: "null" }), false);
});
