import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { exportOfficeDocument, type OfficeExportBlock } from "./office-export.js";
import { convertOfficeToMarkdown } from "./office-to-markdown.js";

export interface OfficeCorpusCase {
  id: string;
  name: string;
  blocks: OfficeExportBlock[];
  requiredText: string[];
  requiredMarkdown: RegExp[];
}

export interface OfficeCorpusReceipt {
  id: string;
  name: string;
  passed: boolean;
  sha256: string;
  byteLength: number;
  outputPath?: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

export const OFFICE_CORPUS: OfficeCorpusCase[] = [
  sample("weekly-report", "项目周报", "# 本周进展\n\n- 完成登录流程\n- 修复导出问题\n\n## 下周计划\n\n1. 用户测试\n2. 发布准备", ["本周进展", "用户测试"], [/^- 完成登录流程/m, /^1\. 用户测试/m]),
  sample("meeting-minutes", "会议纪要", "# 会议结论\n\n> 先解决首次使用流程。\n\n| 行动项 | 负责人 | 截止日 |\n| --- | --- | --- |\n| 修正文案 | 产品 | 周三 |\n| 回归测试 | 研发 | 周五 |", ["会议结论", "修正文案"], [/\| 行动项 \| 负责人 \| 截止日 \|/]),
  sample("proposal", "项目方案", "# 背景\n\n当前流程需要三次重复录入。\n\n# 目标\n\n- 降低操作步骤\n- 保留审阅记录\n\n# 风险\n\n**高风险**动作必须确认。", ["降低操作步骤", "高风险"], [/^# 背景/m, /\*\*高风险\*\*/]),
  sample("decision-memo", "决策备忘录", "# 建议\n\n采用方案 B。\n\n| 方案 | 成本 | 风险 |\n| --- | ---: | --- |\n| A | 10 | 高 |\n| B | 6 | 中 |\n\n> 结论基于当前证据。", ["采用方案 B", "结论基于当前证据"], [/\| B \| 6 \| 中 \|/]),
  sample("requirements", "产品需求说明", "# 用户目标\n\n用户需要在一分钟内开始任务。\n\n## 验收条件\n\n1. 无需选择角色\n2. 可以撤销删除\n3. 错误有恢复入口", ["无需选择角色", "错误有恢复入口"], [/^## 验收条件/m]),
  sample("training-guide", "培训手册", "# 第一次使用\n\n1. 打开应用\n2. 输入目标\n3. 检查结果\n\n## 注意\n\n- 不上传敏感文件\n- 重要操作先确认", ["第一次使用", "重要操作先确认"], [/^1\. 打开应用/m]),
  sample("incident-review", "故障复盘", "# 影响\n\n导出在 09:20 至 09:47 不可用。\n\n# 根因\n\n缓存版本未更新。\n\n# 行动\n\n- 增加回归测试\n- 保留失败证据", ["缓存版本未更新", "保留失败证据"], [/^# 根因/m]),
  sample("research-note", "研究记录", "# 问题\n\n哪种方式更适合普通用户？\n\n## 证据\n\n- 来源 A：完成率较高\n- 来源 B：学习成本较低\n\n## 未确定\n\n仍需真实样本。", ["完成率较高", "仍需真实样本"], [/^## 未确定/m]),
  sample("contract-outline", "合同要点", "# 服务范围\n\n1. 提供本地部署\n2. 提供版本更新\n\n# 数据边界\n\n未经授权不得发送用户文件。", ["服务范围", "未经授权"], [/^2\. 提供版本更新/m]),
  sample("okr", "季度 OKR", "# O1：提升首次成功率\n\n| KR | 目标 | 当前 |\n| --- | ---: | ---: |\n| 首次完成 | 80% | 62% |\n| 次日继续 | 40% | 28% |", ["提升首次成功率", "首次完成"], [/\| 首次完成 \| 80% \| 62% \|/]),
  sample("release-notes", "版本说明", "# 新增\n\n- 项目工作台\n- 文件恢复\n\n# 修复\n\n- 页面切换抖动\n- 历史记录错位\n\n`npm run check` 已通过。", ["项目工作台", "npm run check"], [/`npm run check`/]),
  sample("faq", "常见问题", "# 如何保存？\n\n编辑会自动保存到本机。\n\n# 可以恢复吗？\n\n删除后进入垃圾桶。\n\n# 原文件会改变吗？\n\n不会静默覆盖。", ["删除后进入垃圾桶", "不会静默覆盖"], [/^# 可以恢复吗/m]),
  sample("interview", "用户访谈", "# 受访者\n\n普通办公室用户。\n\n# 原话\n\n> 我希望打开文件就能开始。\n\n# 观察\n\n- 不理解“工作区”\n- 会先点击所有按钮", ["打开文件就能开始", "点击所有按钮"], [/^> 我希望/m]),
  sample("marketing-brief", "传播简报", "# 目标受众\n\n5 至 30 人的小团队。\n\n# 核心信息\n\n**本地保存**、可监督、可继续修改。\n\n# 渠道\n\n1. 产品演示\n2. 用户案例", ["本地保存", "用户案例"], [/\*\*本地保存\*\*/]),
  sample("operations-report", "运营周报", "# 核心指标\n\n| 指标 | 本周 | 环比 |\n| --- | ---: | ---: |\n| 新建任务 | 128 | +12% |\n| 完成任务 | 96 | +8% |\n\n# 解释\n\n完成率提升来自新手入口简化。", ["新建任务", "入口简化"], [/\| 完成任务 \| 96 \| \+8% \|/]),
  sample("finance-note", "财务分析说明", "# 数据时点\n\n2026-08-13 16:00。\n\n# 判断\n\n现金流覆盖六个月。\n\n# 风险\n\n- 收入集中\n- 汇率波动\n\n> 仅作资料整理，不构成投资建议。", ["数据时点", "不构成投资建议"], [/^> 仅作资料整理/m]),
  sample("support-playbook", "客服处理手册", "# 分级\n\n1. 无法启动：高\n2. 导出失败：中\n3. 文案建议：低\n\n## 回复要求\n\n- 先确认影响\n- 给出恢复步骤", ["无法启动", "给出恢复步骤"], [/^## 回复要求/m]),
  sample("user-manual", "用户手册", "# 文件处理\n\n打开后会生成工作副本。\n\n## 快捷操作\n\n- `Ctrl+S` 保存\n- `Ctrl+Z` 撤销\n\n## 限制\n\n复杂版式交给桌面 Office。", ["工作副本", "复杂版式"], [/`Ctrl\+S`/]),
  sample("project-plan", "项目计划", "# 阶段\n\n| 阶段 | 时间 | 产出 |\n| --- | --- | --- |\n| 调研 | 第一周 | 需求清单 |\n| 开发 | 第二周 | 可运行版本 |\n| 验收 | 第三周 | 检查记录 |", ["可运行版本", "检查记录"], [/\| 验收 \| 第三周 \| 检查记录 \|/]),
  sample("resume", "个人履历", "# 经验\n\n## 产品负责人\n\n- 负责本地 AI 产品\n- 建立质量检查体系\n\n# 技能\n\nTypeScript、产品设计、用户研究。", ["产品负责人", "用户研究"], [/^## 产品负责人/m]),
];

export async function runOfficeCorpusRegression(outputDir?: string): Promise<OfficeCorpusReceipt[]> {
  if (outputDir) mkdirSync(outputDir, { recursive: true });
  const receipts: OfficeCorpusReceipt[] = [];
  for (const item of OFFICE_CORPUS) {
    const exported = await exportOfficeDocument({ name: item.name, format: "docx", blocks: item.blocks });
    const converted = await convertOfficeToMarkdown(`${item.id}.docx`, exported.data);
    const checks = [
      { name: "结构检查", passed: exported.validation?.passed === true, detail: exported.validation?.passed ? "DOCX 包结构有效" : "DOCX 包结构无效" },
      ...item.requiredText.map((text) => ({ name: `正文：${text}`, passed: converted.markdown.includes(text), detail: converted.markdown.includes(text) ? "转换后仍存在" : "转换后丢失" })),
      ...item.requiredMarkdown.map((pattern) => ({ name: `结构：${pattern.source}`, passed: pattern.test(converted.markdown), detail: pattern.test(converted.markdown) ? "结构保留" : "结构降级" })),
    ];
    const outputPath = outputDir ? join(outputDir, `${String(receipts.length + 1).padStart(2, "0")}-${item.id}.docx`) : undefined;
    if (outputPath) writeFileSync(outputPath, exported.data);
    receipts.push({
      id: item.id,
      name: item.name,
      passed: checks.every((check) => check.passed),
      sha256: createHash("sha256").update(exported.data).digest("hex"),
      byteLength: exported.data.byteLength,
      outputPath,
      checks,
    });
  }
  return receipts;
}

function sample(id: string, name: string, text: string, requiredText: string[], requiredMarkdown: RegExp[]): OfficeCorpusCase {
  return { id, name, blocks: [{ title: "Markdown", text }], requiredText, requiredMarkdown };
}
