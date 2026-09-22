/**
 * 统计交给代码，判断交给模型。
 *
 * 用户把 CSV、Excel 或按行分隔的记录交给模型时，模型常被要求算中位数、标准差、80/20 分布——
 * 这正是它最不可靠的地方。这里用确定性代码先把每列的结构统计算出来，随材料一起进提示，
 * 并明确要求模型以此为准、不要重算。纯函数，不做模型调用，不读文件。
 */
export interface TabularTable {
  header: string[];
  rows: string[][];
  delimiter: "," | "\t" | "|" | ";";
}

export interface NumericColumnSummary {
  kind: "numeric";
  name: string;
  count: number;
  missing: number;
  min: number;
  max: number;
  sum: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  stdev: number;
}

export interface CategoricalColumnSummary {
  kind: "categorical";
  name: string;
  count: number;
  missing: number;
  distinct: number;
  top: Array<{ value: string; count: number }>;
}

export type ColumnSummary = NumericColumnSummary | CategoricalColumnSummary;

export interface TableSummary {
  rows: number;
  columns: ColumnSummary[];
}

const MIN_ROWS = 3;
const MIN_COLUMNS = 2;
const MAX_ROWS = 20_000;

/** 从一段文字里识别一张表：CSV / TSV / 分号 / 竖线（含 Markdown 表格）。识别不出返回 null。 */
export function detectTable(text: string): TabularTable | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < MIN_ROWS + 1) return null;
  const candidates: TabularTable["delimiter"][] = ["\t", "|", ",", ";"];
  let best: TabularTable | null = null;
  for (const delimiter of candidates) {
    const table = parseWith(lines, delimiter);
    if (table && (!best || table.rows.length * table.header.length > best.rows.length * best.header.length)) best = table;
  }
  return best;
}

function parseWith(lines: string[], delimiter: TabularTable["delimiter"]): TabularTable | null {
  const split = (line: string): string[] => {
    if (delimiter === ",") return splitCsvLine(line);
    const cells = line.split(delimiter);
    if (delimiter === "|") {
      if (cells[0]!.trim() === "") cells.shift();
      if (cells.length && cells[cells.length - 1]!.trim() === "") cells.pop();
    }
    return cells.map((cell) => cell.trim());
  };
  const parsed = lines.map(split).filter((cells) => !(delimiter === "|" && cells.every((cell) => /^:?-{2,}:?$/.test(cell))));
  if (parsed.length < MIN_ROWS + 1) return null;
  const width = parsed[0]!.length;
  if (width < MIN_COLUMNS) return null;
  // 列数一致的行占绝大多数才算表；散文里偶然出现的逗号不算。
  const consistent = parsed.filter((cells) => cells.length === width);
  if (consistent.length < Math.max(MIN_ROWS + 1, Math.ceil(parsed.length * 0.9))) return null;
  const header = consistent[0]!.map((cell, index) => cell || `列${index + 1}`);
  const rows = consistent.slice(1, MAX_ROWS + 1);
  if (rows.every((row) => row.every((cell) => !cell))) return null;
  return { header, rows, delimiter };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** "1,200"、"87%"、"¥3.5"、"-12" 都算数值；日期、编号（如 2026-09-21、A001）不算。 */
export function parseNumber(cell: string): number | null {
  const trimmed = cell.trim();
  if (!trimmed || /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(trimmed) || /^\d{1,2}[:：]\d{2}/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/^[¥$€£]/, "").replace(/[,，%％\s]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function summarizeTable(table: TabularTable): TableSummary {
  const columns = table.header.map((name, index): ColumnSummary => {
    const raw = table.rows.map((row) => row[index] ?? "");
    const present = raw.filter((cell) => cell.trim() !== "");
    const missing = raw.length - present.length;
    const numbers = present.map(parseNumber).filter((value): value is number => value !== null);
    if (present.length >= 2 && numbers.length >= Math.ceil(present.length * 0.8)) {
      const sorted = [...numbers].sort((a, b) => a - b);
      const sum = sorted.reduce((total, value) => total + value, 0);
      const mean = sum / sorted.length;
      const variance = sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / sorted.length;
      return {
        kind: "numeric", name, count: numbers.length, missing: missing + (present.length - numbers.length),
        min: sorted[0]!, max: sorted[sorted.length - 1]!, sum, mean,
        median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75), stdev: Math.sqrt(variance),
      };
    }
    const counts = new Map<string, number>();
    for (const value of present) counts.set(value, (counts.get(value) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 5).map(([value, count]) => ({ value, count }));
    return { kind: "categorical", name, count: present.length, missing, distinct: counts.size, top };
  });
  return { rows: table.rows.length, columns };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

const format = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.abs(value) >= 100 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
  return rounded.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
};

export const TABULAR_STATS_RULE = "以下统计由本机代码按原始数据逐行计算。涉及计数、均值、中位数、分位数、离散度、占比时以此为准，不要自行重算或估算；需要其他口径的统计时说明需要哪一项，不要给出未经计算的数字。";

export function renderTableSummary(summary: TableSummary, label?: string): string {
  const lines = [`数据统计${label ? `（${label}）` : ""}：共 ${summary.rows.toLocaleString("zh-CN")} 行 · ${summary.columns.length} 列`];
  for (const column of summary.columns) {
    if (column.kind === "numeric") {
      lines.push(`- ${column.name}：数值 ${column.count} 个${column.missing ? `，缺失/非数值 ${column.missing}` : ""}；最小 ${format(column.min)}，P25 ${format(column.p25)}，中位数 ${format(column.median)}，P75 ${format(column.p75)}，最大 ${format(column.max)}；均值 ${format(column.mean)}，标准差 ${format(column.stdev)}，合计 ${format(column.sum)}`);
    } else {
      const top = column.top.map((item) => `${item.value}(${item.count})`).join("、");
      lines.push(`- ${column.name}：分类 ${column.count} 个${column.missing ? `，缺失 ${column.missing}` : ""}；不同值 ${column.distinct}${top ? `；最多见 ${top}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** 一段文字能识别成表就返回统计块，否则返回空串。供附件与材料交接直接拼接。 */
export function tabularStatsBlock(text: string, label?: string): string {
  const table = detectTable(text);
  if (!table) return "";
  const summary = summarizeTable(table);
  if (!summary.columns.some((column) => column.kind === "numeric")) return "";
  return `${renderTableSummary(summary, label)}\n${TABULAR_STATS_RULE}`;
}

/**
 * 任务说明里可能夹着多份材料（以「[文件来源：名称]」分段）。逐段识别表格并汇总统计；
 * 没有分段标记时把整段当作一份材料。
 */
export function tabularStatsForMaterials(text: string): string {
  const marker = /\[文件来源：([^\]\n]{1,160})\]\n?/g;
  const blocks: Array<{ label?: string; body: string }> = [];
  let last = 0;
  let current: string | undefined;
  for (const match of text.matchAll(marker)) {
    const body = text.slice(last, match.index);
    if (body.trim()) blocks.push({ label: current, body });
    current = match[1]!.trim();
    last = match.index! + match[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) blocks.push({ label: current, body: tail });
  const rendered = blocks.map((block) => tabularStatsBlock(block.body.replace(/\n\[文件回执：[^\]]*\]\s*$/, ""), block.label)).filter(Boolean);
  return rendered.join("\n\n");
}
