import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";

import { CapabilityRuntime, type ArtifactFormat } from "../../examples/companion/capabilities.js";
import { parseNativeCapabilityPayload } from "../../examples/companion/native-capability-contracts.js";
import { isSupportedPresentationImageData } from "../../examples/companion/native-capability-renderer.js";

const payloads: Record<string, Record<string, unknown>> = {
  "research-brief": {
    kind: "research-brief", title: "研究报告", summary: "结论均回指来源。",
    data: {
      question: "目标领域是否值得进入", plan: ["界定问题", "搜索一手来源", "交叉核验"],
      sources: [
        { id: "S1", title: "官方报告", url: "https://example.com/a", publisher: "示例机构", tier: 1, score: 92, checkedAt: "2026-08-05", claims: ["存在明确需求"], anchors: [{ id: "S1-A1", page: "第 12 页", quote: "目标用户存在明确且重复的需求。" }] },
        { id: "S2", title: "行业数据", url: "https://example.com/b", publisher: "示例数据源", tier: 2, score: 80, checkedAt: "2026-08-05", claims: ["竞争正在增加"], anchors: [{ id: "S2-A1", span: "竞争格局 / 第 3 段", quote: "近一年同类方案数量持续增加。" }] },
      ],
      findings: [{ claim: "需求存在但仍需小范围验证", evidenceIds: ["S1", "S2"], anchorIds: ["S1-A1", "S2-A1"], confidence: 0.82, status: "confirmed" }],
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
      targetUser: "小型团队", problem: "重复整理工作耗时", evidence: [{ id: "E1", source: "目标用户访谈", checkedAt: "2026-08-05", claim: "重复整理每周发生" }], conflicts: ["访谈意愿与实际付费仍不一致"], alternatives: ["人工表格"], signals: [{ signal: "用户主动寻找工具", evidence: "访谈", status: "partial" }],
      assumptions: [{ name: "月活团队", low: 100, base: 500, high: 1200, unit: "个" }],
      scenarios: [{ name: "保守", description: "需求弱", demandScore: 35, competitionScore: 70, executionScore: 75 }, { name: "基准", description: "需求稳定", demandScore: 65, competitionScore: 55, executionScore: 70 }, { name: "积极", description: "需求快速增长", demandScore: 85, competitionScore: 45, executionScore: 65 }],
      modelVersion: "scenario-v1", applicability: ["仅用于早期机会筛选，不代表投资或生产批准"], thesis: "先验证高频重复工作。", invalidation: ["访谈中没有高频痛点"], experiments: [{ name: "访谈", cost: "低", duration: "一周", successSignal: "六成用户每周遇到" }, { name: "手工服务", cost: "中", duration: "两周", successSignal: "三家愿意继续" }], risks: ["样本偏差"],
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

test("演示文稿图片入口只接受有界的常用安全格式", () => {
  assert.equal(isSupportedPresentationImageData("data:image/png;base64,AAAA"), true);
  assert.equal(isSupportedPresentationImageData("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isSupportedPresentationImageData("data:image/icns;base64,AAAA"), false);
  assert.equal(isSupportedPresentationImageData("data:image/heif;base64,AAAA"), false);
  assert.equal(isSupportedPresentationImageData("data:image/jxl;base64,AAAA"), false);
  assert.equal(isSupportedPresentationImageData("data:image/png;base64," + "A".repeat(11_200_001)), false);
});

test("七项原生能力都生成真实产物，演示文稿可导出 PPTX，生成能力会写入能力库", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-native-capabilities-"));
  let current = payloads["research-brief"]!;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: JSON.stringify(current), facts: [] }),
    });
    const expectedFormats: Record<string, ArtifactFormat> = {
      "research-brief": "html", "presentation-builder": "pptx", "thinking-workbench": "html", "product-design": "html",
      "business-deal": "html", "market-opportunity": "html", "ability-builder": "html",
    };
    for (const [capabilityId, format] of Object.entries(expectedFormats)) {
      current = payloads[capabilityId]!;
      const result = await runtime.runAdHocTask({ title: capabilityId, personaId: "clownfish", capabilityId, instruction: "完成测试任务", format });
      assert.equal(result.artifact.format, format);
      assert.ok(existsSync(result.artifact.file));
      assert.ok(statSync(result.artifact.file).size > 100);
      assert.equal(result.artifact.proof?.algorithm, "sha256");
      assert.equal(result.artifact.proof?.byteLength, statSync(result.artifact.file).size);
      assert.match(result.artifact.proof?.contentHash || "", /^[a-f0-9]{64}$/);
      if (format === "pptx") {
        const visualReview = result.artifact.metadata?.presentationVisualReview;
        const visualCheck = result.artifact.proof?.checks.find((check) => check.id === "key-slide-visual-review");
        const expectedLevel = visualReview?.passed ? "verified" : visualCheck?.status === "not-run" ? "validated" : "produced";
        assert.equal(result.artifact.proof?.level, expectedLevel);
        assert.ok(result.artifact.proof?.checks.filter((check) => check.id !== "key-slide-visual-review").every((check) => check.status === "passed"));
        assert.equal(readFileSync(result.artifact.file).subarray(0, 2).toString(), "PK");
        assert.ok(result.artifact.previewFile && existsSync(result.artifact.previewFile));
        const preview = readFileSync(result.artifact.previewFile!, "utf8");
        assert.match(preview, new RegExp('data-artifact-id="' + result.artifact.id + '"'));
        assert.match(preview, /审阅记录/);
        assert.match(preview, /\/assets\/artifact-workspace\.js/);
        assert.equal(result.artifact.proof?.checks.find((check) => check.id === "slide-density")?.status, "passed");
        assert.equal(result.artifact.proof?.checks.find((check) => check.id === "slide-layout-variety")?.status, "passed");
        assert.equal(result.artifact.proof?.checks.find((check) => check.id === "speaker-notes")?.status, "passed");
        if (visualReview?.passed) {
          assert.equal(visualCheck?.status, "passed");
          assert.ok(visualReview.pages.every((page) => existsSync(page.screenshot)));
        } else {
          assert.notEqual(visualCheck?.status, "passed");
        }
        const approved = runtime.updateArtifactWorkspace({
          id: result.artifact.id,
          action: "save",
          expectedRevision: 0,
          current: { status: "done", body: "", notes: {}, checks: {} },
        });
        assert.equal(approved.status, "done");
        assert.equal(
          runtime.snapshot().artifacts.find((item) => item.id === result.artifact.id)?.proof?.level,
          expectedLevel === "verified" ? "approved" : expectedLevel,
        );
      } else {
        assert.equal(result.artifact.proof?.level, "validated");
        assert.ok(result.artifact.proof?.checks.every((check) => check.status === "passed"));
        const html = readFileSync(result.artifact.file, "utf8");
        assert.match(html, /小丑鱼能力结果/);
        assert.doesNotMatch(html, /github\.com|source_url|upstream_repository/i);
        if (capabilityId === "product-design") {
          assert.match(html, /可编辑设计画布/);
          assert.match(html, /data-viewport="desktop"/);
          assert.match(html, /data-viewport="mobile"/);
          assert.match(html, /data-workbench-value data-design-field="sections"/);
          assert.match(html, /data-workbench-value data-design-token="--design-accent"/);
          assert.match(html, /--design-accent:#b85c38/);
          assert.match(html, /artifact-workspace\.js/);
          const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
            .filter((match) => !/type="application\/json"/.test(match[0]))
            .map((match) => match[1]);
          assert.ok(scripts.length > 0);
          scripts.forEach((source) => new Script(source));
        }
      }
    }
    const builtId = runtime.snapshot().artifacts.find((item) => item.capabilityId === "ability-builder")?.metadata?.generatedAbilityId;
    assert.ok(builtId);
    assert.equal(runtime.getAbility(builtId!)?.name, "整理项目周报");
    assert.equal(runtime.getAbility(builtId!)?.admission?.passed, true);
    assert.match(runtime.getAbility(builtId!)?.admission?.contractHash || "", /^[a-f0-9]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("原生能力流式执行不会把内部 JSON 暴露到聊天气泡", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-native-stream-"));
  const raw = JSON.stringify(payloads["thinking-workbench"]!);
  const tokens: string[] = [];
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: raw, facts: [] }),
      notifyStream: async (_personaId, _prompt, cb) => {
        cb.onToken(raw);
        return { reply: raw, facts: [] };
      },
    });
    const result = await runtime.runAdHocTaskStream({
      title: "梳理问题",
      personaId: "clownfish",
      capabilityId: "thinking-workbench",
      instruction: "梳理事实和假设",
      format: "html",
    }, { onStatus: () => undefined, onToken: (token) => tokens.push(token) });
    assert.deepEqual(tokens, []);
    assert.match(result.text, /小丑鱼已经完成/);
    assert.doesNotMatch(result.text, /\"kind\":\"thinking-workbench\"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("原生能力审查结果结构损坏时会再修复一次", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-native-repair-"));
  const replies = ["不是 JSON", "仍然不是 JSON", JSON.stringify(payloads["research-brief"]!)];
  let calls = 0;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: replies[calls++] || "", facts: [] }),
    });
    const result = await runtime.runAdHocTask({
      title: "研究修复",
      personaId: "clownfish",
      capabilityId: "research-brief",
      instruction: "核验资料并给出结论",
      format: "html",
    });
    assert.equal(calls, 3);
    assert.ok(existsSync(result.artifact.file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("原生能力最终修复仍不合法时明确失败", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-native-repair-fail-"));
  let calls = 0;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => {
        calls += 1;
        return { reply: "不是 JSON", facts: [] };
      },
    });
    await assert.rejects(
      runtime.runAdHocTask({
        title: "研究修复失败",
        personaId: "clownfish",
        capabilityId: "research-brief",
        instruction: "核验资料并给出结论",
        format: "html",
      }),
      /能力结果未通过结构校验/,
    );
    assert.equal(calls, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("研究来源锚点生成稳定哈希，缺少定位的已确认结论自动降级", () => {
  const valid = parseNativeCapabilityPayload("research-brief", JSON.stringify(payloads["research-brief"]));
  const source = (valid.data.sources as Array<Record<string, unknown>>)[0]!;
  const anchor = (source.anchors as Array<Record<string, unknown>>)[0]!;
  assert.match(String(anchor.quoteHash), /^[a-f0-9]{64}$/);

  const missing = structuredClone(payloads["research-brief"]!);
  const sources = (missing.data as Record<string, unknown>).sources as Array<Record<string, unknown>>;
  sources.forEach((item) => { item.anchors = []; });
  const parsed = parseNativeCapabilityPayload("research-brief", JSON.stringify(missing));
  const finding = ((parsed.data.findings as Array<Record<string, unknown>>)[0])!;
  assert.equal(finding.status, "partial");
  assert.deepEqual(finding.anchorIds, []);
});
test("演示文稿文字过密、版式单一或缺少备注时只标记为已生成", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-presentation-quality-"));
  const invalid = structuredClone(payloads["presentation-builder"]!);
  const slides = (invalid.data as Record<string, unknown>).slides as Array<Record<string, unknown>>;
  for (const slide of slides) {
    slide.layout = "statement";
    slide.speakerNotes = "";
  }
  slides[1]!.bullets = Array.from({ length: 9 }, (_, index) => "这是明显过长的页面要点 " + (index + 1) + "，用于确认放映密度检查不会被忽略。");
  try {
    let current = payloads["presentation-builder"]!;
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: JSON.stringify(current), facts: [] }),
    });
    const lastGood = await runtime.runAdHocTask({ title: "演示检查", personaId: "clownfish", capabilityId: "presentation-builder", instruction: "生成演示", format: "pptx" });
    current = invalid;
    const result = await runtime.runAdHocTask({ title: "演示检查", personaId: "clownfish", capabilityId: "presentation-builder", instruction: "生成演示", format: "pptx" });
    assert.equal(result.artifact.proof?.level, "produced");
    assert.equal(result.artifact.proof?.checks.find((check) => check.id === "slide-density")?.status, "failed");
    assert.equal(result.artifact.proof?.checks.find((check) => check.id === "slide-layout-variety")?.status, "failed");
    assert.equal(result.artifact.proof?.checks.find((check) => check.id === "speaker-notes")?.status, "failed");
    assert.equal(result.artifact.metadata?.presentationVersion?.state, "needs-review");
    assert.equal(result.artifact.metadata?.presentationVersion?.lastGoodArtifactId, lastGood.artifact.proof?.level !== "produced" ? lastGood.artifact.id : undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("研究结论引用不存在的来源时不会被标记为已验证", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-research-evidence-check-"));
  const invalid = structuredClone(payloads["research-brief"]!);
  const findings = (invalid.data as Record<string, unknown>).findings as Array<Record<string, unknown>>;
  findings[0]!.evidenceIds = ["missing-source"];
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: JSON.stringify(invalid), facts: [] }),
    });
    const result = await runtime.runAdHocTask({ title: "研究检查", personaId: "clownfish", capabilityId: "research-brief", instruction: "检查证据", format: "html" });
    assert.equal(result.artifact.proof?.level, "produced");
    assert.equal(result.artifact.proof?.checks.find((check) => check.id === "research-evidence-links")?.status, "failed");
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
test("交互式能力结果保存状态、版本，并把用户决定带入下一项能力", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-native-workspace-"));
  const options = {
    dataDir: dir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    notify: async () => ({ reply: JSON.stringify(payloads["thinking-workbench"]), facts: [] }),
  };
  try {
    const runtime = new CapabilityRuntime(options);
    const result = await runtime.runAdHocTask({
      title: "持续思考",
      personaId: "clownfish",
      capabilityId: "thinking-workbench",
      instruction: "整理方向",
      format: "html",
    });
    const html = readFileSync(result.artifact.file, "utf8");
    assert.match(html, new RegExp('data-artifact-id="' + result.artifact.id + '"'));
    assert.match(html, /\/assets\/artifact-workspace\.js/);

    runtime.updateArtifactWorkspace({
      id: result.artifact.id,
      action: "version",
      current: {
        notes: { workbenchNotes: "用户确认先验证方案 A" },
        checks: { "experiment-0": true },
        status: "done",
      },
    });

    const restored = new CapabilityRuntime(options);
    assert.equal(restored.artifactWorkspace(result.artifact.id)?.status, "done");
    assert.equal(restored.snapshot().artifacts[0]?.metadata?.workspace?.versionCount, 1);
    const handoff = restored.artifactHandoff(result.artifact.id);
    assert.match(handoff?.text || "", /用户确认先验证方案 A/);
    assert.match(handoff?.text || "", /experiment-0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
