import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzeJson, parseCheckJson } from "../../src/analyzer/json-parse.js";

test("parseAnalyzeJson drops malformed derived entries without failing the event", () => {
  const parsed = parseAnalyzeJson(JSON.stringify({
    archival: {},
    derived: [
      null,
      { content: { text: "not a string" }, layer: "personal_semantic" },
      { content: "   ", layer: "semantic" },
      { content: "valid fact", layer: "semantic" },
    ],
  }));

  assert.deepEqual(parsed.derived, [{ content: "valid fact", layer: "semantic" }]);
});

test("parseCheckJson tolerates a non-object root and malformed entries", () => {
  assert.deepEqual(parseCheckJson("null"), { derived: [], stats: undefined });
  assert.deepEqual(parseCheckJson(JSON.stringify({ derived: [42, { content: "kept" }] })).derived, [
    { content: "kept" },
  ]);
});