import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_REVIEW_CUE = /界面|页面|UI|UX|用户流程|用户路径|体验|易用|首屏|按钮|导航|文件页|能力页|任务页|聊天页|真实检查/i;

const PAGES = [
  { route: "/", file: "index.html", name: "任务与对话" },
  { route: "/capabilities", file: "capabilities.html", name: "能力" },
  { route: "/office", file: "office.html", name: "办公文件" },
  { route: "/tasks", file: "work.html", name: "工作" },
] as const;

export function needsCurrentUiEvidence(instruction: string): boolean {
  return UI_REVIEW_CUE.test(instruction);
}

export function currentUiEvidencePacket(webDir: string): string {
  const pages = PAGES.map((page) => {
    const source = readFileSync(join(webDir, page.file), "utf8");
    const title = textOf(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || page.name);
    const labels = [...source.matchAll(/<(?:h1|h2|button|a)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|button|a)>/gi)]
      .map((match) => textOf(match[1] || ""))
      .filter((label) => label.length >= 2 && label.length <= 36);
    const visibleLabels = [...new Set(labels)].slice(0, 24);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
    return `- ${page.route}（${title}，源码 ${hash}）：${visibleLabels.join("、") || "未提取到静态控件文字"}`;
  });
  return [
    "## 当前界面证据包",
    "证据类型：当前服务使用的 HTML 源码快照，不是历史说明，也不等同于浏览器截图。",
    ...pages,
    "审查要求：先依据上面的当前页面结构判断；证据包没有出现的界面或运行时状态，不得断言存在或不存在，必须标为待实际操作核验。",
  ].join("\n");
}

export function appendCurrentUiEvidence(instruction: string, webDir: string): string {
  if (!needsCurrentUiEvidence(instruction)) return instruction;
  return `${instruction}\n\n${currentUiEvidencePacket(webDir)}`;
}

function textOf(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}
