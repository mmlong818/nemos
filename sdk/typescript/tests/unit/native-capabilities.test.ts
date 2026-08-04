import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime, type ArtifactFormat } from "../../examples/companion/capabilities.js";
import { parseNativeCapabilityPayload } from "../../examples/companion/native-capability-contracts.js";

const payloads: Record<string, Record<string, unknown>> = {
  "research-brief": {
    kind: "research-brief", title: "研究报告", summary: "结论均回指来源。",
    data: {
      question: "目标领域是否值得进入", plan: ["界定问题", "搜索一手来源", "交叉核验"],
      sources: [
        { id: "S1", title: "官方报告", url: "https://example.com/a", publisher: "示例机构", tier: 1, score: 92, checkedAt: "2026-08-05", claims: ["存在明确需求"] },
        { id: "S2", title: "行业数据", url: "https://example.com/b", publisher: "示例数据源", tier: 2, score: 80, checkedAt: "2026-08-05", claims: ["竞争正在增加"] },
      ],
      findings: [{ claim: "需求存在但仍需小范围验证", evidenceIds: ["S1", "S2"], confidence: 0.82, status: "confirmed" }],
      conclusion: "建议先做低成本验证。", limitations: ["缺少真实付费数据"], nextSteps: ["访谈五位目标用户"],
    },
  },
  "presentation-builder": {
    kind: "presentation-builder", title: "季度汇报", summary: "一套三页的可讲述演示。",
    data: {
      audience: "管理层", purpose: "说明进展和下一步", theme: "sand",
      slides: [
        { title: "季度进展", keyMessage: "目标如期推进", layout: "title", bullets: [], speakerNotes: "开场说明范围。" },
        { title: "关键变化", keyMessage: "三个动作带来主要改善", layout: "two-column", bullets: ["动作一", "动作二", "动作三"], speakerNotes: "解释因果边界。" },
        { title: "下一步", keyMessage: "集中验证一个核心假设", layout: "closing", bullets: ["负责人明确", "两周复盘"], speakerNotes: "确认决策。" },
      ],
    },
  },
  "thinking-workbench": {
    kind: "thinking-workbench", title: "问题梳理", summary: "形成两个方向和一个验证。",
    data: {
      problem: "应该先做哪个方向", facts: ["资源有限"], assumptions: [{ text: "方向 A 需求更强", risk: "中" }], contradictions: ["速度与完整性冲突"],
      options: [{ name: "方向 A", upside: "更快", downside: "范围小", signal: "用户完成率" }, { name: "方向 B", upside: "更完整", downside: "更慢", signal: "留存率" }],
      experiments: [{ name: "原型测试", method: "五人试用", cost: "低", successSignal: "四人独立完成" }], nextActions: ["准备原型"],
    },
  },
  "product-design": {
    kind: "product-design", title: "产品方案", summary: "围绕一个完整用户任务设计。",
    data: {
      user: "第一次使用的新手", job: "快速完成第一份结果", successCriteria: ["三分钟内开始", "知道结果保存在哪里"],
      flow: [{ step: "输入目标", userAction: "说明要完成的事", systemResponse: "推荐做法" }, { step: "确认执行", userAction: "补充材料", systemResponse: "后台运行并保存" }],
      informationArchitecture: ["开始", "进行中", "已完成", "文件"],
      screens: [{ name: "开始", purpose: "表达目标", primaryAction: "帮我准备", sections: ["目标输入", "常用能力"], states: ["空", "已填写"] }, { name: "结果", purpose: "查看交付", primaryAction: "打开结果", sections: ["摘要", "文件"], states: ["加载", "完成", "失败"] }],
      designTokens: { accent: "#b85c38", background: "#f2eee5", surface: "#fffdf8", text: "#292823" }, acceptanceChecks: ["键盘可操作", "小屏不横向溢出"],
    },
  },
  "business-deal": {
    kind: "business-deal", title: "合作推进", summary: "明确关键人、异议和下一步。",
    data: {
      accountContext: "双方正在评估试点。", mutualValue: "用小范围试点验证共同价值。",
      stakeholders: [{ name: "业务负责人", role: "决策参与者", influence: "高", interest: "效果", status: "待确认" }], evidence: ["已有需求说明"], assumptions: ["预算尚未确认"],
      objections: [{ objection: "投入是否过高", response: "先做固定范围试点", evidenceNeeded: "试点成本" }], boundaries: ["不承诺未验证收益"], agenda: ["确认目标", "确认范围"],
      followUps: [{ channel: "邮件", message: "建议先确认试点范围和成功标准。" }], nextActions: ["约定下一次评审"],
    },
  },
  "market-opportunity": {
    kind: "market-opportunity", title: "机会模拟", summary: "用三种情景检验机会。",
    data: {
      targetUser: "小型团队", problem: "重复整理工作耗时", alternatives: ["人工表格"], signals: [{ signal: "用户主动寻找工具", evidence: "访谈", status: "partial" }],
      assumptions: [{ name: "月活团队", low: 100, base: 500, high: 1200, unit: "个" }],
      scenarios: [{ name: "保守", description: "需求弱", demandScore: 35, competitionScore: 70, executionScore: 75 }, { name: "基准", description: "需求稳定", demandScore: 65, competitionScore: 55, executionScore: 70 }, { name: "积极", description: "需求快速增长", demandScore: 85, competitionScore: 45, executionScore: 65 }],
      thesis: "先验证高频重复工作。", invalidation: ["访谈中没有高频痛点"], experiments: [{ name: "访谈", cost: "低", duration: "一周", successSignal: "六成用户每周遇到" }, { name: "手工服务", cost: "中", duration: "两周", successSignal: "三家愿意继续" }], risks: ["样本偏差"],
    },
  },
  "ability-builder": {
    kind: "ability-builder", title: "周报能力", summary: "通过资格和触发测试。",
    data: {
      qualification: { shouldBuild: true, reason: "每周重复且输入输出稳定", repeatSignals: ["固定周期"] },
      spec: {
        name: "整理项目周报", description: "从项目更新中形成可发送周报。", defaultFormat: "md",
        triggerExamples: ["整理本周项目周报", "把这些进展做成周报", "生成团队周报"], nonTriggerExamples: ["写一篇新闻", "查询天气"],
        inputs: ["项目更新"], steps: ["收集事实", "按状态分组", "列出风险和下一步"], decisionRules: ["不虚构负责人"], outputs: ["周报正文"], exceptions: ["缺少更新时列出缺口"], checks: ["事实可追溯", "行动项有负责人或标为待定"],
        prompt: "将项目更新整理为周报，区分已完成、进行中、阻塞、风险和下一步；不得编造事实。",
      },
      testCases: [{ request: "整理周报", shouldTrigger: true, reason: "匹配" }, { request: "生成团队周报", shouldTrigger: true, reason: "匹配" }, { request: "汇总本周进展", shouldTrigger: true, reason: "匹配" }, { request: "查询天气", shouldTrigger: false, reason: "不匹配" }, { request: "写新闻", shouldTrigger: false, reason: "不匹配" }],
    },
  },
};

test("七项原生能力都生成真实产物，演示文稿可导出 PPTX，生成能力会写入能力库", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-native-capabilities-"));
  let current = payloads["research-brief"]!;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "zhiwei", name: "知微" }],
      notify: async () => ({ reply: JSON.stringify(current), facts: [] }),
    });
    const expectedFormats: Record<string, ArtifactFormat> = {
      "research-brief": "html", "presentation-builder": "pptx", "thinking-workbench": "html", "product-design": "html",
      "business-deal": "html", "market-opportunity": "html", "ability-builder": "html",
    };
    for (const [capabilityId, format] of Object.entries(expectedFormats)) {
      current = payloads[capabilityId]!;
      const result = await runtime.runAdHocTask({ title: capabilityId, personaId: "zhiwei", capabilityId, instruction: "完成测试任务", format });
      assert.equal(result.artifact.format, format);
      assert.ok(existsSync(result.artifact.file));
      assert.ok(statSync(result.artifact.file).size > 100);
      if (format === "pptx") {
        assert.equal(readFileSync(result.artifact.file).subarray(0, 2).toString(), "PK");
        assert.ok(result.artifact.previewFile && existsSync(result.artifact.previewFile));
      } else {
        const html = readFileSync(result.artifact.file, "utf8");
        assert.match(html, /Nemos 能力结果/);
        assert.doesNotMatch(html, /github\.com|source_url|upstream_repository/i);
      }
    }
    const builtId = runtime.snapshot().artifacts.find((item) => item.capabilityId === "ability-builder")?.metadata?.generatedAbilityId;
    assert.ok(builtId);
    assert.equal(runtime.getAbility(builtId!)?.name, "整理项目周报");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("生成能力兼容字段完整但少一个结束符的模型结果", () => {
  const payload = structuredClone(payloads["ability-builder"]!);
  const data = payload.data as Record<string, unknown>;
  const spec = data.spec as Record<string, unknown>;
  spec.testCases = data.testCases;
  delete data.testCases;
  const raw = JSON.stringify(payload).slice(0, -1);

  const parsed = parseNativeCapabilityPayload("ability-builder", raw);
  assert.equal(parsed.kind, "ability-builder");
  assert.equal(Array.isArray(parsed.data.testCases), true);
});
