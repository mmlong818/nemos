# examples/scenario-profiles

演示 v0.2 scenario profile 对同一份内容产出的分类差异。

## 跑法

```bash
cd sdk/typescript
npm install
ANTHROPIC_API_KEY=sk-... npx tsx examples/scenario-profiles/index.ts
```

## 输入

一段 MiniMax M3 发布纪要（混合「报告陈述 + 用户主观判断 + 团队规划」三种成分）。

## 预期差异

| Profile | 主导 layer | 关键行为 |
|---|---|---|
| `chat` | episodic + personal_semantic | 「我个人觉得」「我们准备」被归 personal_semantic；时间被抽出 |
| `doc-research` | semantic + procedural | 强制零 personal_semantic（即使原文有「我」也不算用户）；技术要点归 semantic |
| `diary` | episodic + personal_semantic | 所有 derived 标 sensitive=true，默认 search 不可见 |
| `coding` | procedural + semantic | 技术决策、API 计划归 procedural；架构概念归 semantic |

## 为什么需要 scenario

v0.1 的单 SYSTEM_PROMPT 把研报里出现的「我」当用户偏好抽取——这是错的。
scenario 让 SDK 知道当前 context，从而决定「这个『我』是文档作者还是用户本人」。
