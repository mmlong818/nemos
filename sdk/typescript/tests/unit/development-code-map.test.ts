import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDevelopmentCodeMap, renderDevelopmentCodeMap } from "../../examples/companion/development-code-map.js";

test("项目代码地图提取主要符号和模块依赖", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-code-map-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), [
      'import { readFile } from "node:fs";',
      'export interface AppConfig { name: string }',
      'export function startApp() { return readFile; }',
    ].join("\n"), "utf8");
    const map = buildDevelopmentCodeMap(root);
    assert.equal(map.analyzedFileCount, 1);
    assert.deepEqual(map.entries[0]?.symbols, ["AppConfig", "startApp"]);
    assert.deepEqual(map.entries[0]?.exports, ["AppConfig", "startApp"]);
    assert.deepEqual(map.entries[0]?.dependencies, ["node:fs"]);
    assert.match(renderDevelopmentCodeMap(map), /src\/index\.ts/);
    assert.equal(map.fingerprint.length, 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
