import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "examples/companion/web/assets/settings-center.js"), "utf8");

test("普通用户可以从设置中心导入、审查并测试连接器", () => {
  assert.match(source, /extensionFile/);
  assert.match(source, /api\/agent\/extension\/validate/);
  assert.match(source, /requiresExecutableConfirmation/);
  assert.match(source, /permissionExpansion/);
  assert.match(source, /api\/platform\/connector\/test/);
  assert.match(source, /api\/agent\/extension\/upgrade/);
  assert.match(source, /review\.installed/);
});
