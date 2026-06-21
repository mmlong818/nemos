// utils/arousal.ts — 启发式 arousal 信号检测
//
// 用途：
// 1. 给 LLM 失败时的 fallback
// 2. archival 默认估值（spec 说 archival 不需要 arousal，但 v0.1 简化为统一字段）
// 3. mock provider 用

export function estimateArousal(text: string): number {
  let score = 0;
  if (/[!！]{1,}/.test(text)) score += 0.2;
  if (/[!！]{2,}/.test(text)) score += 0.2;
  if (/[?？]{2,}/.test(text)) score += 0.15;
  if (
    /(?:崩溃|愤怒|气死|讨厌|开心|激动|兴奋|fuck|damn|amazing|terrible|hate|love)/i.test(
      text,
    )
  ) {
    score += 0.3;
  }
  if (text.length > 200) score += 0.1;
  return Math.min(score, 1);
}

export function detectArousalSignals(text: string): string[] {
  const sigs: string[] = [];
  if (/[!！]{2,}/.test(text)) sigs.push("multi_exclamation");
  if (/(?:崩溃|愤怒|气死|讨厌|开心|激动|兴奋)/.test(text)) {
    sigs.push("emotion_words_zh");
  }
  if (/(?:fuck|damn|amazing|terrible|hate|love)/i.test(text)) {
    sigs.push("emotion_words_en");
  }
  if (text.length > 200) sigs.push("long_form");
  return sigs;
}

export function estimateSurprise(text: string): number {
  let score = 0.3;
  if (/(突然|居然|没想到|第一次|意外|suddenly|unexpected|first time)/i.test(text)) {
    score += 0.4;
  }
  if (/(?:奇怪|奇特|不一样|different|strange|weird)/i.test(text)) {
    score += 0.2;
  }
  return Math.min(score, 1);
}
