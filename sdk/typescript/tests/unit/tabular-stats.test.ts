import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { detectTable, parseNumber, summarizeTable, tabularStatsBlock, tabularStatsForMaterials } from "../../examples/companion/tabular-stats.js";

const csv = [
  "creator,platform,views,hook",
  "甲,TikTok,\"1,200\",POV: 你以为",
  "乙,TikTok,300,3 things",
  "丙,IG,900,POV: 你以为",
  "丁,IG,,3 things",
  "戊,TikTok,2400,POV: 你以为",
].join("\n");

test("CSV, TSV and markdown tables are detected; prose with commas is not", () => {
  const table = detectTable(csv)!;
  assert.equal(table.delimiter, ",");
  assert.deepEqual(table.header, ["creator", "platform", "views", "hook"]);
  assert.equal(table.rows.length, 5);
  assert.equal(detectTable("a\tb\tc\n1\t2\t3\n4\t5\t6\n7\t8\t9")!.delimiter, "\t");
  const markdown = "| 品类 | 销量 |\n| --- | --- |\n| A | 10 |\n| B | 20 |\n| C | 30 |";
  const md = detectTable(markdown)!;
  assert.equal(md.delimiter, "|");
  assert.deepEqual(md.header, ["品类", "销量"]);
  assert.equal(md.rows.length, 3, "the separator row is not data");
  assert.equal(detectTable("这是一段普通文字，里面有逗号，也有第二句，第三句。\n还有第二行，也有逗号。\n第三行，逗号。\n第四行。"), null);
  assert.equal(detectTable("a,b\n1,2"), null, "too few rows to be a table");
});

test("numbers with thousands separators, percents and currency parse; dates and codes do not", () => {
  assert.equal(parseNumber("1,200"), 1200);
  assert.equal(parseNumber("87%"), 87);
  assert.equal(parseNumber("¥3.5"), 3.5);
  assert.equal(parseNumber("-12"), -12);
  assert.equal(parseNumber("2026-09-21"), null);
  assert.equal(parseNumber("A001"), null);
  assert.equal(parseNumber("09:30"), null);
});

test("numeric columns get exact order statistics and categorical columns get top values", () => {
  const summary = summarizeTable(detectTable(csv)!);
  const views = summary.columns.find((column) => column.name === "views")!;
  assert.equal(views.kind, "numeric");
  if (views.kind !== "numeric") return;
  assert.equal(views.count, 4);
  assert.equal(views.missing, 1);
  assert.equal(views.min, 300);
  assert.equal(views.max, 2400);
  assert.equal(views.sum, 4800);
  assert.equal(views.mean, 1200);
  assert.equal(views.median, 1050);
  assert.equal(views.p25, 750);
  assert.equal(views.p75, 1500);
  const hook = summary.columns.find((column) => column.name === "hook")!;
  assert.equal(hook.kind, "categorical");
  if (hook.kind !== "categorical") return;
  assert.equal(hook.distinct, 2);
  assert.deepEqual(hook.top[0], { value: "POV: 你以为", count: 3 });
});

test("the stats block names the source, forbids recomputation, and stays silent for non-tables", () => {
  const block = tabularStatsBlock(csv, "campaign.csv");
  assert.match(block, /^数据统计（campaign\.csv）：共 5 行 · 4 列/);
  assert.match(block, /- views：数值 4 个，缺失\/非数值 1；最小 300，P25 750，中位数 1,050，P75 1,500，最大 2,400；均值 1,200，标准差 [\d,.]+，合计 4,800/);
  assert.match(block, /不要自行重算或估算/);
  assert.equal(tabularStatsBlock("只是几句话。\n第二句。\n第三句。\n第四句。"), "");
  assert.equal(tabularStatsBlock("a,b\nx,y\nz,w\nq,r"), "", "a table with no numeric column adds nothing the model cannot read itself");
});

test("materials split by 文件来源 markers are summarised per file and reach the capability run prompt", async () => {
  const instruction = `请分析这批数据\n[文件来源：campaign.csv]\n${csv}\n[文件回执：6 行 · 100 字 · 完整]\n[文件来源：notes.txt]\n这是说明文字，没有表格。`;
  const stats = tabularStatsForMaterials(instruction);
  assert.match(stats, /数据统计（campaign\.csv）/);
  assert.doesNotMatch(stats, /notes\.txt/);

  const dir = mkdtempSync(join(tmpdir(), "clownfish-tabular-stats-"));
  try {
    const prompts: string[] = [];
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async (_personaId: string, prompt: string) => { prompts.push(prompt); return { reply: "解读\n\n交付完成。", facts: [] }; },
    });
    const task = runtime.createTask({ title: "数据", personaId: "clownfish", capabilityId: "decision-brief", instruction });
    await runtime.runTask(task.id, "manual");
    const prompt = prompts[0];
    assert.match(prompt, /数据统计（campaign\.csv）：共 5 行 · 4 列/);
    assert.ok(prompt.indexOf("数据统计") < prompt.indexOf("User request:"), "statistics arrive before the raw request");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
