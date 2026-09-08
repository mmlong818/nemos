/**
 * 交付物对齐：让助理把自己**最没把握的判断**随交付物一起交出来。
 *
 * 动机：小丑鱼在事实层已经很谨慎——记忆分已记住／待确认、来源要标注、材料不足要
 * 写"未知"。但**交付物本身没有这一层**：一份研究报告读起来同样自信，无论其中某句
 * 是硬证据还是助理在材料不足时挑的一种解释。用户因此无法把复核精力放在真正需要的
 * 那两三处。
 *
 * 做法：交付物产出之后**单独跑一次**，只问这一个问题。备选方案是让主回复在末尾附一段
 * 结构块，省一次模型调用；但那样一旦格式没跟上就静默退化成"什么都没有"，而且要从正文里
 * 把块摘掉。单独跑一次更稳：主交付物完全不受影响，这一次失败了也只是少一段附注。
 *
 * 这次调用必须是廉价且无副作用的：不带工具、不读长期记忆、不写事实、轮次和输出都收紧。
 * 它是对已完成交付物的一次机械追问，不是第二次创作。
 */

export interface OpenQuestion {
  /** 没把握的那个判断，一句话。 */
  question: string;
  /** 交付物里当前采用了哪个做法——没有这个，用户无法判断要不要改。 */
  assumed: string;
  /** 判断错了会影响交付物的哪一部分。 */
  affects: string;
}

export const OPEN_QUESTION_LIMITS = {
  /** 最多三条。再多就不是"最没把握的几个"，而是把不确定性摊开让人自己挑。 */
  maxItems: 3,
  maxFieldLength: 200,
  /** 送去追问的交付物截断长度。只需要判断依据，不需要全文。 */
  maxDeliverableChars: 6_000,
} as const;

/**
 * 纯转换类能力跳过追问。
 *
 * 润色、格式转换、OCR、提示词反推的判断空间在字词与版式层面，逐句都可以「再确认」，
 * 列出来只是噪音；而它们恰好是用户最不需要复核的产出。
 *
 * 这里只能写**真实存在的能力 id**（守卫测试会逐个核对）。工作流目录里的
 * quick-translate / quick-polish / quick-speech 不是 CapabilityRuntime 的能力，
 * 不走这条执行链，写进来会变成一条永远命中不到的死规则。
 */
const SKIPPED_CAPABILITY_IDS = new Set([
  "article-polish",
  "document-conversion",
  "ocr-extraction",
  "image-prompt-reconstruction",
]);

export function skipsOpenQuestions(capabilityId: string): boolean {
  return SKIPPED_CAPABILITY_IDS.has(capabilityId);
}

/**
 * 追问用的提示。
 *
 * 三条设计要点：
 * - 要求只输出 JSON，因为这次回复不进交付物，只进结构化附注；
 * - 明确"没有就返回空数组"，否则模型会为了满足格式而编出三条来；
 * - 明确不要复述交付物内容，否则它会把摘要当成"没把握的判断"。
 */
export function openQuestionsPrompt(input: {
  capabilityName: string;
  title: string;
  deliverable: string;
}): string {
  return [
    `你刚刚以「${input.capabilityName}」完成了一份交付物：${input.title}`,
    "",
    "现在只回答一个问题：这份交付物里，你自己最没把握的判断是哪几个？",
    "",
    "只列你在材料不足或存在多种合理解释时**自己挑了一个**的地方。材料明确支持的结论不算；",
    "交付物里已经写明「未知」或「待确认」的地方不算（那些已经告诉用户了）。",
    "最多三条，按「判断错了影响最大」排序。确实没有就返回空数组，不要为了凑数编造。",
    "",
    "只输出 JSON，不要解释、不要代码围栏、不要复述交付物内容：",
    '[{"question":"没把握的判断","assumed":"交付物里当前采用的做法","affects":"判断错了会影响哪一部分"}]',
    "",
    "交付物正文（可能已截断）：",
    input.deliverable.slice(0, OPEN_QUESTION_LIMITS.maxDeliverableChars),
  ].join("\n");
}

/**
 * 解析追问结果。
 *
 * 任何异常都返回空数组而不是抛：拿不到待确认判断不该让已经做完的交付物失败。
 * 这是"少一段附注"和"整个任务红掉"之间的取舍。
 */
export function parseOpenQuestions(raw: string): OpenQuestion[] {
  const parsed = safeJson(raw);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { questions?: unknown })?.questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];
  const result: OpenQuestion[] = [];
  for (const item of items) {
    const record = item as Partial<OpenQuestion> | null;
    const question = field(record?.question);
    const assumed = field(record?.assumed);
    const affects = field(record?.affects);
    // 三个字段缺一就丢弃整条：只有"没把握的判断"而不说当前采用了什么，用户无法据此行动。
    if (!question || !assumed || !affects) continue;
    result.push({ question, assumed, affects });
    if (result.length >= OPEN_QUESTION_LIMITS.maxItems) break;
  }
  return result;
}

function safeJson(raw: string): unknown {
  const text = String(raw ?? "").trim();
  // 模型仍可能套代码围栏；剥掉之后再找第一个 JSON 值。
  const unfenced = text.startsWith("```")
    ? text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
    : text;
  const start = unfenced.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(unfenced.lastIndexOf("]"), unfenced.lastIndexOf("}"));
  if (end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function field(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, OPEN_QUESTION_LIMITS.maxFieldLength)
    : "";
}
