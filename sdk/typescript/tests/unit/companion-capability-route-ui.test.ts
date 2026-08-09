import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(__dirname, "..", "..", "examples", "companion", "web", "assets", "capability-center.js"), "utf8");

test("automatic ability selection uses the server router with a local fallback", () => {
  assert.match(source, /fetch\("\/api\/capabilities\/route"/);
  assert.match(source, /materialNames: state\.materials\.map/);
  assert.match(source, /selectCapability\(await recommendCapability\(goal\)\)/);
  assert.match(source, /return matchCapability\(goal\)/);
});
