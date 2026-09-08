/**
 * 提示指令预算：数一份系统提示里到底下了多少条祈使指令，并设上限。
 *
 * 为什么需要它：指令是会堆积的，而堆积的代价看不见。每一轮功能都会往提示里追加
 * 几条"必须/不要/永远"，没有任何一次追加显得过分；但越过某个数量之后，模型不会
 * 报错也不会拒绝，它只是**静默跳过埋得最深的那几条**。于是最早写下的、最重要的
 * 约束最先失效，而所有测试仍然是绿的。
 *
 * 动机来源：Dex Horthy（HumanLayer，12-Factor Agents 作者）复盘自己的 RPI 工作流时，
 * 把"系统提示累积到 85 条以上指令，模型静默跳过最深处的约束"列为第一号失败模式。
 * 见 docs/agentic-workflow-2026-09-08.md。
 *
 * ## 这个数字是相对量，不是绝对指令数
 *
 * 统计办法是"命中祈使标记的行数"。它能可靠抓住中文指令（不要／必须／只能……），
 * 而助理提示以中文为主，所以对这份提示是稳定的。但它**漏掉英文裸动词祈使句**
 * （"End the deliverable…"、"Prefer structured sources…"）。试过两种补法都更糟：
 * 把编号行全算成指令，会把提示里的数据清单（可用工具、任务、能力列表）算进来；
 * 取并集则两种误差都保留。
 *
 * 所以这里的数**只能用来比较同一份提示随时间的变化**，不能当成"这份提示有 N 条指令"。
 * 上限相应地按「当前实测 + 余量」定，而不是套用别人那个 85——套 85 的话这个守卫
 * 永远不会触发，等于没有。
 *
 * ## 覆盖范围
 *
 * 只覆盖助理的对话/任务提示（engine.send 装配的那份）。**能力执行提示不在内**：
 * buildRunPrompt 会把可用工具、已有任务、能力目录等运行时数据拼进去，条数随本机
 * 状态浮动，做成守卫会变成随机失败。那条路径要控制的话得先把数据块与指令块分开。
 *
 * ## 它不检查什么
 *
 * 指令的**质量**。一条含糊的和一条精确的都算一条；把两条合成一句废话能骗过它。
 * 所以它只适合当"该复审了"的信号，不适合当优化目标。
 */

/** 中英文的祈使/禁止标记。命中其中任一即计一条指令。 */
const IMPERATIVE_MARKERS = [
  "不要", "不得", "不能", "不该", "必须", "只能", "只应", "永远", "绝不", "禁止", "应当", "务必",
  "Never", "never", "Always", "always", "MUST", "must ", "Do not", "do not", "Don't", "don't",
  "should not", "Should not", "avoid ", "Avoid ",
];

export interface PromptBudgetReport {
  /** 命中祈使标记的行数。 */
  instructions: number;
  /** 非空行总数，用于判断提示整体规模。 */
  lines: number;
  characters: number;
  /** 超出上限的条数；0 表示在预算内。 */
  overBy: number;
  /** 按块归类的条数，指出该去哪里削减。 */
  byBlock: Array<{ block: string; instructions: number }>;
}

export const PROMPT_BUDGET = {
  /**
   * 单份助理系统提示的上限。
   *
   * 按「当前实测 + 余量」定：日常对话与任务模式各 20 条，带在场契约时 25 条，
   * 因此 40 留出约 15 条的增长空间。这个数的作用是**在下一次无声增长时叫停**，
   * 不是声称 40 条就会出问题。
   *
   * 越线时应当有人决定"要加的这条比现有哪条更重要"，而不是默默把上限调高——
   * 把上限调高是这个守卫唯一的失效方式。
   */
  maxInstructions: 40,
} as const;

/**
 * 统计一份已装配好的系统提示。
 *
 * 传入的应当是**真正送给模型的那份字符串**，不是源码。按源码统计会把没走进本轮
 * 的分支也算进来，得到一个永远偏高、且和实际请求无关的数字。
 */
export function measurePromptBudget(system: string): PromptBudgetReport {
  const lines = system.split("\n").map((line) => line.trim()).filter(Boolean);
  const byBlock = new Map<string, number>();
  let current = "（无标题）";
  let instructions = 0;
  for (const line of lines) {
    // 【】和 ## 是这套提示里实际使用的两种小节标记。
    const heading = /^【(.+?)】/.exec(line)?.[1] ?? /^#{1,3}\s*(.+)$/.exec(line)?.[1];
    if (heading) current = heading.slice(0, 40);
    if (!IMPERATIVE_MARKERS.some((marker) => line.includes(marker))) continue;
    instructions += 1;
    byBlock.set(current, (byBlock.get(current) ?? 0) + 1);
  }
  return {
    instructions,
    lines: lines.length,
    characters: system.length,
    overBy: Math.max(0, instructions - PROMPT_BUDGET.maxInstructions),
    byBlock: [...byBlock].sort((a, b) => b[1] - a[1]).map(([block, count]) => ({ block, instructions: count })),
  };
}

/** 越预算时给出可执行的说明：说清超了多少、以及该先看哪一块。 */
export function promptBudgetFailure(report: PromptBudgetReport): string | undefined {
  if (!report.overBy) return undefined;
  const worst = report.byBlock.slice(0, 3).map((item) => `${item.block}(${item.instructions})`).join("、");
  return [
    `系统提示有 ${report.instructions} 条祈使指令，超出预算 ${report.overBy} 条（上限 ${PROMPT_BUDGET.maxInstructions}）。`,
    `指令最密集的小节：${worst}。`,
    "越线不代表提示写错了，但要有人决定新增的这条比现有哪条更重要——直接调高上限是这个守卫唯一的失效方式。",
  ].join("");
}
