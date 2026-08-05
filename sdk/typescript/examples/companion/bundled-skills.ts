export interface BundledSkill {
  name: string;
  description: string;
  personaId: string;
  sourceUrl?: string;
  defaultFormat: "md" | "html" | "txt" | "json" | "doc";
  content: string;
}

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    name: "aihot",
    description: "AI 圈 24 小时重要事件简报：综合公开搜索、已接入的微信私域源和 X 时间线，输出可核验的事件摘要。",
    personaId: "clownfish",
    sourceUrl: "https://aihot.virxact.com/aihot-skill/",
    defaultFormat: "md",
    content: `---
name: aihot
description: AI 圈 24 小时重要事件简报：综合公开搜索、已接入的微信私域源和 X 时间线，输出可核验的事件摘要。
version: 0.1.0
origin: bundled
---

# AIHOT

Use this skill when the user asks for AI 圈重要事件、AI 热点、过去 24 小时 AI 新闻、模型/开源/产品/公司动态、X/微信来源简报, or asks to run aihot.

## Procedure

1. Treat this as a live-source task. Search current public sources and include the local query time.
2. If WeChat private-source inbox or X timeline is configured, use those as private leads. If they are not configured or return no fresh items, say so clearly.
3. Cross-check important claims against stronger public sources: official announcements, company blogs, papers, repositories, release notes, product pages, or credible media.
4. Do not reuse old local artifacts as current news. Old artifacts can only suggest topics to re-check.
5. Rank events by user impact: model/API changes, major product releases, open-source releases, research with practical impact, policy/industry moves, and notable funding/business changes.
6. For every event, include: title, what happened, why it matters, source status, and what to watch next.
7. If the source is weak, label it as "待核验" instead of presenting it as fact.

## Output

Default format: Markdown.

Recommended structure:

- Time window and query time
- Top 5-10 important events
- Signals from X/WeChat, if configured
- Official/public verification links or source names
- Watchlist for follow-up

End with: 交付完成。`,
  },
];
