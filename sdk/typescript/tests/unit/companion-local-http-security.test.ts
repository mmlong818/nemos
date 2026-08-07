import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertPublicWebUrl,
  isAllowedLocalRequest,
  isLoopbackAddress,
  isPrivateNetworkAddress,
} from "../../examples/companion/local-http-security.js";

test("本机服务只接受回环地址、正确 Host 和同源浏览器请求", () => {
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isAllowedLocalRequest({ remoteAddress: "127.0.0.1", host: "127.0.0.1:8791", origin: "http://127.0.0.1:8791", port: 8791 }), true);
  assert.equal(isAllowedLocalRequest({ remoteAddress: "192.168.1.5", host: "127.0.0.1:8791", port: 8791 }), false);
  assert.equal(isAllowedLocalRequest({ remoteAddress: "127.0.0.1", host: "attacker.example", port: 8791 }), false);
  assert.equal(isAllowedLocalRequest({ remoteAddress: "127.0.0.1", host: "127.0.0.1:8791", origin: "https://attacker.example", port: 8791 }), false);
  assert.equal(isAllowedLocalRequest({ remoteAddress: "127.0.0.1", host: "localhost:8791", secFetchSite: "cross-site", port: 8791 }), false);
});

test("网页读取拒绝常见本机、内网和特殊用途地址", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
  assert.equal(isPrivateNetworkAddress("1.1.1.1"), false);
  await assert.rejects(() => assertPublicWebUrl("http://127.0.0.1/private"), /private network/);
  await assert.rejects(() => assertPublicWebUrl("http://localhost/private"), /local web address/);
});

test("Companion 服务固定监听回环地址并限制原始上传和网页响应", () => {
  const source = readFileSync(join(process.cwd(), "examples", "companion", "server.ts"), "utf8");
  assert.match(source, /server\.listen\(PORT, "127\.0\.0\.1"/);
  assert.match(source, /isAllowedLocalRequest\(/);
  assert.match(source, /readRawBody\(req, 12 \* 1024 \* 1024\)/);
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /readBoundedResponseText\(resp, 1_000_000\)/);
});
