/**
 * 通用守卫：能力目录里的每一项，在**所有按 id 建的映射表**里都要有条目。
 *
 * 起因：新增两项自媒体能力时，能力表和目录都加了，但五张按目录 id 手工维护的表一处
 * 都没登记。后果不会让任何测试变红——图标落到兜底、目标框占位文案为空、
 * 「评估这几个选题」被路到「方案比较」。全靠人记住同步八处。
 *
 * 这里只钉"有没有条目"，不钉内容。内容对不对是各自的测试的事。
 *
 * 每张表覆盖的子集不同，且必须写清理由——用错子集会让守卫要求工具去登记只有流程 Bot
 * 才用的表，那种守卫最后一定被放宽。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const asset = (file: string) => readFileSync(`examples/companion/web/assets/${file}`, "utf8");

const browser: { ClownfishWorkflowCatalog?: any } = {};
runInNewContext(asset("workflow-catalog.js"), { window: browser });
const catalog = browser.ClownfishWorkflowCatalog!;

// 目录是在 runInNewContext 里求值的，那里的数组带的是**另一个 realm 的 Array.prototype**，
// 直接 deepStrictEqual 会因为原型不同而失败（报"缺少：空"却是红的）。Array.from 拷回本 realm。
/** 全部目录项（含 4 个工具）。 */
const ALL_IDS: string[] = Array.from(catalog.capabilities, (item: any) => item.id);
/** 只有流程 Bot（有 identities 的那些）。工具不出现在 Bot 页，也不参与聊天建议。 */
const WORKFLOW_IDS: string[] = Array.from(catalog.workflows, (item: any) => item.id);
const ALL_BACKEND_IDS: string[] = Array.from(catalog.capabilities, (item: any) => item.backendId);

/**
 * 按名字切出一段源码。
 *
 * 切片一旦锚点没匹配上就会静默返回半个文件，断言反而**偶然通过**——所以这里在
 * 切完之后校验起止都找到了，且切出来的长度合理。
 */
function block(source: string, opening: string, closing: string): string {
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `没找到起始锚点：${opening}`);
  const end = source.indexOf(closing, start + opening.length);
  assert.notEqual(end, -1, `没找到结束锚点：${closing}`);
  const slice = source.slice(start + opening.length, end);
  assert.ok(slice.length > 40, `切出来的片段太短，锚点可能不对：${opening}`);
  return slice;
}

/** 收集 `key: ` 形式的对象键。 */
function objectKeys(slice: string): Set<string> {
  return new Set([...slice.matchAll(/(?:^|[,{\s])([A-Za-z][A-Za-z0-9-]*)\s*:/g)].map((match) => match[1]!));
}

/** 收集 `["id", …]` 或 `['id', …]` 形式的数组首项。 */
function tupleIds(slice: string): Set<string> {
  return new Set([...slice.matchAll(/\[\s*['"]([A-Za-z][A-Za-z0-9-]*)['"]\s*,/g)].map((match) => match[1]!));
}

function assertCovers(label: string, present: Set<string>, required: string[]) {
  const missing = required.filter((id) => !present.has(id));
  assert.equal(missing.length, 0, `${label} 缺少：${missing.join("、")}`);
  assert.ok(required.length > 10, `${label} 的对照清单只有 ${required.length} 项，目录可能没读到`);
}

const center = asset("capability-center.js");

test("目标示例覆盖全部目录项——缺失时目标框占位文案是空的", () => {
  assertCovers("EXAMPLE_PROMPTS", objectKeys(block(center, "const EXAMPLE_PROMPTS = {", "\n};")), ALL_IDS);
});

test("卡片色覆盖全部目录项——缺失时多张卡片会落到同一个兜底色", () => {
  assertCovers("ICON_TONES", objectKeys(block(center, "const ICON_TONES = {", "\n};")), ALL_IDS);
});

test("前端目标匹配规则覆盖全部目录项——缺失时该能力永远不会被目标文本选中", () => {
  assertCovers("MATCH_RULES", tupleIds(block(center, "const MATCH_RULES = [", "\n];")), ALL_IDS);
});

test("Bot 页图标表覆盖全部流程 Bot——缺失时图标落到 boxes 兜底", () => {
  const team = asset("assistant-team.js");
  // 兜底是 `|| "boxes"`：缺失不会报错，只会安静地换一个图标——所以必须有守卫。
  assert.ok(team.includes('[t.id] || "boxes"'), "图标表的兜底写法变了，下面这条切片要跟着改");
  const map = block(team, 'data-app-icon="${esc((', ")[t.id] ||");
  assertCovers("Bot 页图标表", objectKeys(map), WORKFLOW_IDS);
});

test("聊天里的技能建议覆盖全部流程 Bot——缺失时说出这件事也不会被建议", () => {
  assertCovers("skill-handoff", tupleIds(block(asset("skill-handoff.js"), "const patterns=[", "\n  ];")), WORKFLOW_IDS);
});

test("服务端路由覆盖全部能力——缺失时该能力只能靠用户手点，自动路由永远到不了", () => {
  const router = readFileSync("examples/companion/capability-router.ts", "utf8");
  const routes = block(router, "const ROUTES: RouteRule[] = [", "\n];");
  const present = new Set([...routes.matchAll(/capabilityId: "([a-z-]+)"/g)].map((match) => match[1]!));
  assertCovers("ROUTES", present, ALL_BACKEND_IDS);
});

// 前端 MATCH_RULES 与服务端 ROUTES 是两份手工维护的副本。这里只钉"两边认识同一批
// 能力"；**顺序不钉**——两张表都是先命中先赢，顺序差异会造成路由结果不同，但用测试
// 表达顺序等价需要把两套正则都跑一遍，那是另一件事，记在这里而不是假装已经覆盖。
test("前端与服务端路由认识同一批能力", () => {
  const router = readFileSync("examples/companion/capability-router.ts", "utf8");
  const serverCatalogIds = new Set(
    [...block(router, "const ROUTES: RouteRule[] = [", "\n];").matchAll(/catalogId: "([A-Za-z]+)"/g)].map((m) => m[1]!),
  );
  const clientIds = tupleIds(block(center, "const MATCH_RULES = [", "\n];"));
  assert.deepEqual([...serverCatalogIds].sort(), [...clientIds].sort());
});

test("目录里每个 backendId 都是真实存在的能力标识", () => {
  // 不引入 CapabilityRuntime（那要建临时目录）：内置能力表就在源码里，直接核对。
  const source = readFileSync("examples/companion/capabilities.ts", "utf8");
  const builtin = new Set([...block(source, "const BUILTIN_ABILITIES: Capability[] = [", "\n];")
    .matchAll(/id: "([a-z-]+)"/g)].map((match) => match[1]!));
  // quick-* 三个工具不是 CapabilityRuntime 的能力，走各自的独立路径。
  const quickTools = new Set(["quick-translate", "quick-speech", "quick-polish"]);
  const missing = ALL_BACKEND_IDS.filter((id) => !quickTools.has(id) && !builtin.has(id));
  assert.equal(missing.length, 0, `目录里这些 backendId 不是真实能力：${missing.join("、")}`);
});
