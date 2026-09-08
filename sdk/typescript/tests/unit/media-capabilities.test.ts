import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { routeCapability } from "../../examples/companion/capability-router.js";
import { skipsOpenQuestions } from "../../examples/companion/deliverable-alignment.js";
import {
  MEDIA_REQUIRED_PARAMETERS,
  topicEvaluationPrompt,
  videoScriptPrompt,
} from "../../examples/companion/media-capability-prompts.js";

const MEDIA_IDS = ["topic-evaluation", "video-script"] as const;

function abilities() {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-media-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: (async () => ({ reply: "", facts: [] })) as never,
    });
    return runtime.listAbilities().map((item) => ({ ...item }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("两项自媒体能力都是内置能力，交付格式为 md", () => {
  const found = abilities().filter((item) => (MEDIA_IDS as readonly string[]).includes(item.id));
  assert.equal(found.length, MEDIA_IDS.length);
  for (const ability of found) {
    assert.equal(ability.kind, "builtin", ability.id);
    // 口播稿和选题清单都要能直接复制进提词器或备忘录，HTML 反而多一层。
    assert.equal(ability.defaultFormat, "md", ability.id);
    assert.ok(ability.prompt.length > 200, `${ability.id} 的提示不该是一句话`);
    assert.ok(ability.name && ability.description, ability.id);
  }
});

// 目录里写一个不存在的 backendId 会变成"点了没反应"的入口——与给不存在的能力 id 写跳过
// 规则、给不存在的抛出点注册失败编号是同一类错误。
test("工作流目录里每个 backendId 都是真实存在的能力", () => {
  const ids = new Set(abilities().map((item) => item.id));
  const browser: { ClownfishWorkflowCatalog?: any } = {};
  runInNewContext(readFileSync("examples/companion/web/assets/workflow-catalog.js", "utf8"), { window: browser });
  const catalog = browser.ClownfishWorkflowCatalog;
  const quickToolIds = new Set(catalog.tools.map((item: any) => item.backendId));
  for (const item of catalog.capabilities) {
    // 三个 quickTool 不走 CapabilityRuntime，不该要求它们存在于能力表里。
    if (quickToolIds.has(item.backendId)) continue;
    assert.ok(ids.has(item.backendId), `目录里的 ${item.backendId} 不是真实能力`);
  }
  for (const id of MEDIA_IDS) {
    const entry = catalog.capabilities.find((item: any) => item.backendId === id);
    assert.ok(entry, `${id} 没有进工作流目录`);
    assert.equal(entry.format, "md");
    const bot = catalog.workflows.find((item: any) => item.backendId === id);
    assert.ok(bot, `${id} 没有成为流程 Bot`);
    assert.equal(bot.category, "自媒体");
  }
});

// 这两项恰恰是最需要交出假设的——参数不全时它们会自己挑一个平台和时长。
test("两项能力都不在跳过追问的名单里", () => {
  for (const id of MEDIA_IDS) assert.equal(skipsOpenQuestions(id), false, id);
});

test("四项参数是唯一清单，且两条提示都引用了它", () => {
  assert.deepEqual([...MEDIA_REQUIRED_PARAMETERS], ["平台", "时长", "受众", "目标"]);
  for (const prompt of [topicEvaluationPrompt(), videoScriptPrompt()]) {
    for (const parameter of MEDIA_REQUIRED_PARAMETERS) {
      assert.match(prompt, new RegExp(parameter), `提示里缺参数：${parameter}`);
    }
    assert.match(prompt, /参数假设/);
    // 参数不全时先做完再列假设，而不是交回一串问题。
    assert.match(prompt, /不要因为参数不全就只交回一串问题/);
  }
});

// 小丑鱼不抓平台热搜榜：抓取失效时会安静地给出空榜或过时榜，用户看不出区别。
// 提示必须明确禁止"当前热度高"这类说法，也不能出现任何暗示自己能取榜单的词。
test("两条提示都禁止声称实时热度，且不含抓取热搜的说法", () => {
  for (const prompt of [topicEvaluationPrompt(), videoScriptPrompt()]) {
    assert.match(prompt, /禁止声称掌握实时热度/);
    assert.match(prompt, /这类题材通常/);
    assert.doesNotMatch(prompt, /抓取|爬取|热搜/);
  }
});

test("选题评估要求逐条给判断、理由与排序依据，且不自行凑数", () => {
  const prompt = topicEvaluationPrompt();
  assert.match(prompt, /做 \/ 不做 \/ 改造后做/);
  assert.match(prompt, /不要写「可以考虑」/);
  assert.match(prompt, /排序依据/);
  assert.match(prompt, /不要自行凑数/);
  // 找选题不是这个能力的事——由用户或「深度研究」提供。
  assert.match(prompt, /你不负责去找新选题/);
});

test("脚本要求 3 个开头备选、带时间轴的分段和单一结尾动作", () => {
  const prompt = videoScriptPrompt();
  assert.match(prompt, /3 个备选/);
  assert.match(prompt, /时间轴/);
  assert.match(prompt, /口播要写成可以照读的话/);
  assert.match(prompt, /只列一个/);
  // 时间对不上的脚本没法照着拍。
  assert.match(prompt, /时间轴总长必须与设定的时长一致/);
});

test("目标路由：选题不再被「评估」吃到方案比较，脚本也不再无人认领", () => {
  // 加这两条之前：「评估这几个选题」命中 decision-brief 的 /评估/，脚本则谁都不命中。
  assert.equal(routeCapability({ goal: "评估这几个选题里哪个值得做" }).capabilityId, "topic-evaluation");
  assert.equal(routeCapability({ goal: "帮我排一下这个月的内容排期" }).capabilityId, "topic-evaluation");
  assert.equal(routeCapability({ goal: "把这个题目写成短视频脚本" }).capabilityId, "video-script");
  assert.equal(routeCapability({ goal: "写一段口播稿" }).capabilityId, "video-script");
});

// 「脚本」是个多义词。要求它紧邻短视频/视频/口播/分镜，否则会把写代码的请求劫持过来。
test("脚本模式不劫持写代码的请求", () => {
  for (const goal of ["写个 Python 脚本跑一下这个目录", "帮我改下这个构建脚本"]) {
    assert.notEqual(routeCapability({ goal }).capabilityId, "video-script", goal);
  }
});
