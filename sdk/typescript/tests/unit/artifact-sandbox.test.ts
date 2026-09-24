import assert from "node:assert/strict";
import test from "node:test";

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

test("沙箱里的页面发往 /api 的请求带 Origin: null，本机同源检查拒绝", () => {
  const base = { remoteAddress: "127.0.0.1", host: "127.0.0.1:8787", port: 8787 };
  assert.equal(isAllowedLocalRequest({ ...base, origin: "http://127.0.0.1:8787" }), true, "应用自己的页面照常可用");
  assert.equal(isAllowedLocalRequest({ ...base, origin: "null" }), false);
});
