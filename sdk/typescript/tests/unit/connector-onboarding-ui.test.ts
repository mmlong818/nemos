import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "examples/companion/web/assets/work-center.js"), "utf8");

test("普通用户可以从资料页导入、审查并测试连接器", () => {
  assert.match(source, /data-import-connector/);
  assert.match(source, /api\/agent\/extension\/validate/);
  assert.match(source, /requiresExecutableConfirmation/);
  assert.match(source, /permissionExpansion/);
  assert.match(source, /api\/platform\/connector\/test/);
  assert.match(source, /data-upgrade-extension/);
  assert.match(source, /api\/agent\/extension\/upgrade/);
  assert.match(source, /review\.installed/);
  assert.match(source, /data-rollback-extension/);
  assert.match(source, /api\/agent\/extension\/rollback/);
});
