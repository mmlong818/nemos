import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { OfficeFileSessionStore } from "../../examples/companion/office-file-sessions.js";
import { applyPptxTextEdits, readPptxText } from "../../examples/companion/office-pptx-text-edit.js";
import { applyStructuredOfficeEdit } from "../../examples/companion/office-structured-edit.js";
import { validateOfficeFile } from "../../examples/companion/office-validation.js";

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

/** 第一个文本框的段落里有三段不同格式的 run；第二个文本框完全不动。 */
function slideXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P} ${A}><p:cSld><p:spTree>` +
    "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>" +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p>' +
    '<a:r><a:rPr lang="zh-CN"/><a:t>收入同比</a:t></a:r>' +
    '<a:r><a:rPr lang="zh-CN" b="1"/><a:t>增长 18%</a:t></a:r>' +
    '<a:r><a:rPr lang="zh-CN" sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>需复核</a:t></a:r>' +
    "</a:p></p:txBody></p:sp>" +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Note"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p>' +
    '<a:r><a:rPr lang="zh-CN" i="1"/><a:t>这一段不动</a:t></a:r>' +
    "</a:p></p:txBody></p:sp>" +
    "</p:spTree></p:cSld></p:sld>";
}

async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  zip.file("ppt/slides/slide1.xml", slideXml());
  return zip.generateAsync({ type: "nodebuffer" });
}

async function runsOf(data: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) || "";
  return (xml.match(/<a:r>[\s\S]*?<\/a:r>/g) || []).map((run) => {
    const text = run.match(/<a:t>([\s\S]*?)<\/a:t>/)?.[1] ?? "";
    const bold = /\bb="1"/.test(run) ? "B" : "-";
    const italic = /\bi="1"/.test(run) ? "I" : "-";
    const color = run.match(/srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ?? "------";
    const size = run.match(/\bsz="(\d+)"/)?.[1] ?? "----";
    return `${bold}${italic} ${color} ${size} ${text}`;
  });
}

test("读取 PPTX 时区分可改文字的段落与只能透传的内容", async () => {
  const blocks = await readPptxText(await buildPptx());
  const texts = blocks.filter((block) => block.textEditable).map((block) => block.text);
  assert.deepEqual(texts, ["收入同比增长 18%需复核", "这一段不动"]);
  assert.equal(blocks[0]?.slideIndex, 0);
  assert.ok(blocks.every((block) => Number.isInteger(block.elementIndex) && Number.isInteger(block.paragraphIndex)));
});

test("改动落在单个 run 内时，其余 run 的文字与格式一字不动", async () => {
  const original = await buildPptx();
  const before = await runsOf(original);
  const blocks = await readPptxText(original);
  const target = blocks.find((block) => block.text.includes("18%"))!;

  const result = await applyPptxTextEdits(original, [{
    slideIndex: target.slideIndex,
    elementIndex: target.elementIndex,
    paragraphIndex: target.paragraphIndex,
    text: target.text.replace("收入同比", "总收入同比"),
  }]);
  assert.deepEqual(result.changed, ["0:0:0"]);
  assert.deepEqual(result.skipped, []);

  const after = await runsOf(result.data);
  assert.equal(after.length, before.length);
  assert.equal(after[0], "-- ------ ---- 总收入同比");
  // 加粗与红色大字的 run 完全没变
  assert.equal(after[1], before[1]);
  assert.equal(after[2], before[2]);
  assert.equal(after[3], before[3], "另一个文本框也不该被动");
});

test("跨越不同格式的改动被拒绝，而不是打乱格式", async () => {
  const original = await buildPptx();
  const blocks = await readPptxText(original);
  const target = blocks.find((block) => block.text.includes("18%"))!;
  const result = await applyPptxTextEdits(original, [{
    slideIndex: target.slideIndex,
    elementIndex: target.elementIndex,
    paragraphIndex: target.paragraphIndex,
    text: target.text.replace("同比增长 18%", "XXX"),
  }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.skipped, ["0:0:0"]);
  assert.deepEqual(await runsOf(result.data), await runsOf(original));
});

test("修改结果通过结构检查", async () => {
  const original = await buildPptx();
  const blocks = await readPptxText(original);
  const note = blocks.find((block) => block.text === "这一段不动")!;
  const result = await applyPptxTextEdits(original, [{
    slideIndex: note.slideIndex,
    elementIndex: note.elementIndex,
    paragraphIndex: note.paragraphIndex,
    text: "这一段改了",
  }]);
  const receipt = await validateOfficeFile("pptx", result.data);
  assert.deepEqual(receipt.checks.filter((check) => !check.passed).map((check) => check.name), []);
});

test("对比已冻结的文字级替换：旧路径丢行内格式，新路径不丢", async () => {
  const original = await buildPptx();
  const legacy = await applyStructuredOfficeEdit({
    kind: "pptx",
    data: original,
    blocks: [{ title: "第一页", text: "总收入同比\n增长 18%\n需复核" }],
    complete: false,
  });
  const legacyRuns = await runsOf(legacy.data);
  // 旧路径按出现顺序整体重写全部 <a:t>，第二个文本框会被第一页的内容污染
  assert.notDeepEqual(legacyRuns, await runsOf(original));

  const blocks = await readPptxText(original);
  const target = blocks.find((block) => block.text.includes("18%"))!;
  const engine = await applyPptxTextEdits(original, [{
    slideIndex: target.slideIndex,
    elementIndex: target.elementIndex,
    paragraphIndex: target.paragraphIndex,
    text: target.text.replace("收入同比", "总收入同比"),
  }]);
  const engineRuns = await runsOf(engine.data);
  assert.match(engineRuns[1] || "", /^B- ------ ---- 增长 18%$/);
});

test("会话层写回覆盖工作副本，改动前的版本仍可取回", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-pptx-writeback-"));
  try {
    const original = await buildPptx();
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("汇报.pptx", original);

    const blocks = await store.readPptxBlocks(created.id);
    assert.ok(blocks.some((block) => block.textEditable));

    const target = blocks.find((block) => block.text.includes("18%"))!;
    const saved = await store.savePptxTextEdits(created.id, created.contentHash, [{
      slideIndex: target.slideIndex,
      elementIndex: target.elementIndex,
      paragraphIndex: target.paragraphIndex,
      text: target.text.replace("收入同比", "总收入同比"),
    }]);
    assert.deepEqual(saved.changed, ["0:0:0"]);
    assert.equal(saved.validation.passed, true);
    assert.notEqual(saved.session.contentHash, created.contentHash);

    const imported = store.history(created.id).find((version) => version.reason === "imported");
    assert.ok(imported);
    const restored = store.restore(created.id, imported.id, saved.session.contentHash);
    assert.equal(readFileSync(restored.file).equals(original), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("跨格式改动在会话层给出可照做的说明", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-pptx-unsafe-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("汇报.pptx", await buildPptx());
    const blocks = await store.readPptxBlocks(created.id);
    const target = blocks.find((block) => block.text.includes("18%"))!;
    await assert.rejects(
      () => store.savePptxTextEdits(created.id, created.contentHash, [{
        slideIndex: target.slideIndex,
        elementIndex: target.elementIndex,
        paragraphIndex: target.paragraphIndex,
        text: target.text.replace("同比增长 18%", "XXX"),
      }]),
      /请分段修改/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("非 PowerPoint 文件不走这条路径", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-pptx-guard-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("notes.md", Buffer.from("content"));
    await assert.rejects(() => store.readPptxBlocks(created.id), /只有 PowerPoint/);
    await assert.rejects(
      () => store.savePptxTextEdits(created.id, created.contentHash, [{ slideIndex: 0, elementIndex: 0, paragraphIndex: 0, text: "x" }]),
      /只处理 PowerPoint/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
