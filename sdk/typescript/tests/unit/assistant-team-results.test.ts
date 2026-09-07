import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { listBotMarket } from "../../examples/companion/bot-market.js";
import { formatTeamDeliveryText } from "../../examples/companion/assistant-team.js";
const context: any = {};
runInNewContext(readFileSync("examples/companion/web/assets/assistant-team-results.js", "utf8"), context);
const { resultText, botDraft, materialStarter } = context.ClownfishTeamResults;
const job = (fields: any[]) => ({ status: "succeeded", payload: { teamPlan: { workers: [{ template: { id: "bot-designer" } }] } }, result: { data: { delivery: { fields } } } });
const fields = [{ label: "Bot 名称", value: "摘录助理" }, { label: "工作规则", value: "仅处理本次共享文字，不调用工具。" }];

test("文本交付保留来源、换行与特殊字符，不输出执行型文件", () => {
  const value = "<script>alert(1)</script>\n第二行";
  const out = resultText({ summary: "待审阅", fields: [{ label: "正文", value, sources: ["S1", "未提供"] }] });
  assert.ok(out.includes(value)); assert.match(out, /来源：S1；未提供/); assert.match(out, /不代表事实正确/);
  assert.equal(out, formatTeamDeliveryText({ summary: "待审阅", fields: [{ label: "正文", value, sources: ["S1", "未提供"] }] }));
});
test("设计结果只能提取草稿：成功状态与冻结模板来源必需，不继承权限或标识", () => {
  const draft = botDraft(job(fields));
  assert.equal(draft.name, "摘录助理"); assert.equal(draft.instructions, fields[1].value);
  assert.deepEqual(Object.keys(draft), ["name", "instructions"]);
  assert.throws(() => botDraft({ ...job(fields), status: "failed" }), /成功/);
  assert.throws(() => botDraft({ ...job(fields), payload: { teamPlan: { workers: [{ name: "Bot 设计助理" }] } } }), /成功/);
});
test("规则草稿缺字段、重复字段与超长字段均拒绝，不悄悄截断", () => {
  assert.throws(() => botDraft(job(fields.slice(0, 1))), /缺失/);
  assert.throws(() => botDraft(job([...fields, fields[0]])), /重复/);
  assert.throws(() => botDraft(job([{ ...fields[0], value: "字".repeat(61) }, fields[1]])), /过长/);
  assert.throws(() => botDraft(job([fields[0], { ...fields[1], value: "字".repeat(4001) } ])), /过长/);
});
test("八种资料提纲可填入，但永远不覆盖用户材料；示例明确标记而非用户事实", () => {
  for(const t of listBotMarket()){
    assert.equal(materialStarter("", t, false), t.inputTemplate);
    assert.match(materialStarter("", t, true), /^\[合成示例验收，不是我的个人事实\]/);
    assert.throws(() => materialStarter("我的重要材料", t, false), /已保留/);
    assert.throws(() => materialStarter("我的重要材料", t, true), /已保留/);
  }
});
