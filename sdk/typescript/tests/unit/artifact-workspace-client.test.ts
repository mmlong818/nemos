import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(__dirname, "..", "..", "examples", "companion");
const renderer = readFileSync(join(root, "native-capability-renderer.ts"), "utf8");
const client = readFileSync(join(root, "web", "assets", "artifact-workspace.js"), "utf8");

test("能力工作台只使用服务端版本状态", () => {
  assert.doesNotMatch(renderer, /localStorage/);
  assert.match(renderer, /\/assets\/artifact-workspace\.js/);
  assert.match(client, /values\[field\.id\] = field\.value/);
  assert.match(client, /if \(hydrating\) return/);
});
