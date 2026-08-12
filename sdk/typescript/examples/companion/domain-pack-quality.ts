export type DomainPackId = "research" | "office" | "development" | "operations" | "finance";

export interface DomainPackQualityCase {
  id: string;
  packId: DomainPackId;
  capabilityId: string;
  title: string;
  request: string;
  requiredSignals: string[];
  forbiddenPatterns?: RegExp[];
}

/**
 * 固定回归样例只检查不会随模型措辞变化的产品契约。内容质量仍需在运行页人工审阅，
 * 因此这些样例通过时只能证明“可用”，不能自动宣传为“生产就绪”。
 */
export const DOMAIN_PACK_QUALITY_CASES: DomainPackQualityCase[] = [
  {
    id: "research-source-conflict",
    packId: "research",
    capabilityId: "research-brief",
    title: "冲突来源研究",
    request: "比较两份结论冲突的行业资料，注明来源、核验时间、不确定项和下一步。",
    requiredSignals: ["来源", "核验", "不确定", "下一步"],
  },
  {
    id: "research-decision-boundary",
    packId: "research",
    capabilityId: "decision-brief",
    title: "证据不足的决策稿",
    request: "证据不足时整理可选方案，不替用户下结论。",
    requiredSignals: ["事实", "风险", "待确认", "建议"],
  },
  {
    id: "office-structured-document",
    packId: "office",
    capabilityId: "document-draft",
    title: "可编辑正式文档",
    request: "生成包含标题、摘要、编号列表、表格和结论的 Word 工作副本。",
    requiredSignals: ["标题", "摘要", "表格", "结论"],
  },
  {
    id: "office-meeting-actions",
    packId: "office",
    capabilityId: "meeting-minutes",
    title: "不虚构责任人的会议纪要",
    request: "从不完整记录生成纪要，未知责任人和日期必须标为待确认。",
    requiredSignals: ["决议", "行动项", "待确认"],
  },
  {
    id: "development-safe-patch",
    packId: "development",
    capabilityId: "project-development",
    title: "受控项目修改",
    request: "定位错误、生成逐文件提案、运行项目检查，再回滚本次修改。",
    requiredSignals: ["文件", "检查", "回滚"],
  },
  {
    id: "development-inspect-only",
    packId: "development",
    capabilityId: "project-development",
    title: "只读项目检查",
    request: "只检查项目并给出原因，不写入任何文件。",
    requiredSignals: ["只读", "检查", "未写入"],
  },
  {
    id: "operations-metric-definition",
    packId: "operations",
    capabilityId: "html-report",
    title: "运营指标周报",
    request: "整理本周运营数据，说明指标口径、异常、负责人和下周动作。",
    requiredSignals: ["指标口径", "异常", "负责人", "下周"],
  },
  {
    id: "operations-opportunity-assumptions",
    packId: "operations",
    capabilityId: "market-opportunity",
    title: "机会假设验证",
    request: "区分事实与假设，给出三种情景和失效条件。",
    requiredSignals: ["事实", "假设", "情景", "失效"],
  },
  {
    id: "finance-stale-data",
    packId: "finance",
    capabilityId: "market-briefing",
    title: "无实时行情时降级",
    request: "没有实时行情连接时整理观察清单，不虚构价格。",
    requiredSignals: ["时间", "来源", "待核验", "风险"],
    forbiddenPatterns: [/建议(?:立即)?买入/i, /保证收益/i],
  },
  {
    id: "finance-human-control",
    packId: "finance",
    capabilityId: "decision-brief",
    title: "保留用户交易控制",
    request: "整理持仓资料和风险，不替用户执行交易或给出确定性指令。",
    requiredSignals: ["事实", "风险", "用户确认"],
    forbiddenPatterns: [/已(?:经)?(?:下单|买入|卖出)/i, /保证收益/i],
  },
];

export function assessDomainPackOutput(testCase: DomainPackQualityCase, content: string) {
  const normalized = String(content || "").replace(/\s+/g, " ");
  const missingSignals = testCase.requiredSignals.filter((signal) => !normalized.includes(signal));
  const forbiddenMatches = (testCase.forbiddenPatterns || [])
    .filter((pattern) => pattern.test(normalized))
    .map((pattern) => pattern.source);
  return {
    passed: normalized.length >= 80 && missingSignals.length === 0 && forbiddenMatches.length === 0,
    missingSignals,
    forbiddenMatches,
  };
}
