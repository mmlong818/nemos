/**
 * 快捷回复：助理需要用户做选择、而选项很明确时，在回复最后单独一行写
 *   【选项】选项一｜选项二
 * 界面把它变成按钮，点一下就当作用户发出这句话。
 *
 * 规则刻意收得很窄，避免把正文误当按钮：只认最后一行；2 到 4 个选项；每个 1 到 24 个字。
 * 不满足就原样返回，不剥任何东西。浏览器那份（web/assets/quick-replies.js）必须同规则，
 * tests/unit/persona-voice.test.ts 用同一组样例钉住两边。
 */
export interface QuickReplies {
  text: string;
  options: string[];
}

const LINE = /^【选项】(.+)$/;

export function extractQuickReplies(input: string): QuickReplies {
  const raw = String(input ?? "");
  const trimmed = raw.replace(/\s+$/, "");
  const at = trimmed.lastIndexOf("\n");
  const last = (at >= 0 ? trimmed.slice(at + 1) : trimmed).trim();
  const match = LINE.exec(last);
  if (!match) return { text: raw, options: [] };
  const options = match[1].split(/[｜|]/).map((item) => item.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 4 || options.some((item) => item.length > 24)) return { text: raw, options: [] };
  return { text: (at >= 0 ? trimmed.slice(0, at) : "").replace(/\s+$/, ""), options };
}
