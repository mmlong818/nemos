import assert from "node:assert/strict";
import test from "node:test";

import { markdownToStructuredDocument } from "../../examples/companion/structured-document.js";

test("转换后的副本保留标题、列表、表格和来源位置", () => {
  const document = markdownToStructuredDocument("docx", [
    "# 项目方案",
    "",
    "这是正文。",
    "",
    "1. 调研",
    "2. 实施",
    "",
    "| 项目 | 状态 |",
    "| --- | --- |",
    "| 文档 | 完成 |",
  ].join("\n"));

  assert.equal(document.schema, "clownfish.document.v1");
  assert.deepEqual(document.blocks.map((block) => block.kind), ["heading", "paragraph", "list", "table"]);
  assert.equal(document.blocks[0]?.level, 1);
  assert.equal(document.blocks[2]?.ordered, true);
  assert.deepEqual(document.blocks[3]?.rows, [["项目", "状态"], ["文档", "完成"]]);
  assert.deepEqual(document.blocks[3]?.source, { startLine: 8, endLine: 10 });
});

test("转换后的副本保留引用和代码而不是压成一段文本", () => {
  const document = markdownToStructuredDocument("md", "> 说明\n> 第二行\n\n```ts\nconst value = 1;\n```");
  assert.deepEqual(document.blocks.map((block) => block.kind), ["quote", "code"]);
  assert.equal(document.blocks[0]?.text, "说明\n第二行");
  assert.equal(document.blocks[1]?.text, "const value = 1;");
});
