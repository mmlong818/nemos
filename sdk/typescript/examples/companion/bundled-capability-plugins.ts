import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentExtensionManifest,
  AgentExtensionProvider,
  AgentExtensionToolDescriptor,
  AgentTool,
} from "../../src/index.js";

export type BundledCapabilityPluginId = "browser.playwright" | "analysis.safe-table" | "productivity.communication-files" | "media.generate";

export interface BundledCapabilityPluginStatus {
  id: BundledCapabilityPluginId;
  name: string;
  description: string;
  installed: boolean;
  installable: boolean;
  reason?: string;
  manifest: AgentExtensionManifest;
}

export function bundledCapabilityPluginCatalog(input: {
  packageRoot: string;
  installedIds?: readonly string[];
}): BundledCapabilityPluginStatus[] {
  const installed = new Set(input.installedIds ?? []);
  const playwrightCli = resolve(input.packageRoot, "node_modules", "@playwright", "mcp", "cli.js");
  const manifests = [
    browserManifest(playwrightCli),
    safeAnalysisManifest(),
    productivityManifest(),
    mediaManifest(),
  ];
  return manifests.map((manifest) => {
    const dependencyReady = manifest.id !== "browser.playwright" || existsSync(playwrightCli);
    return {
      id: manifest.id as BundledCapabilityPluginId,
      name: manifest.name,
      description: manifest.description,
      installed: installed.has(manifest.id),
      installable: dependencyReady,
      reason: dependencyReady ? undefined : "缺少官方 @playwright/mcp 依赖",
      manifest,
    };
  });
}

export function createBundledCapabilityProvider(
  manifest: AgentExtensionManifest,
  dataDir: string,
): AgentExtensionProvider | undefined {
  if (manifest.id === "analysis.safe-table") return staticProvider(manifest, safeAnalysisTools());
  if (manifest.id === "productivity.communication-files") return staticProvider(manifest, productivityTools());
  if (manifest.id === "media.generate") return staticProvider(manifest, mediaTools(dataDir));
  return undefined;
}

function browserManifest(playwrightCli: string): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "browser.playwright",
    name: "浏览器操作",
    version: "1.0.0",
    description: "使用微软 Playwright MCP 在隔离浏览器中打开网页、点击、填写、截图和下载；不会接管现有登录会话。",
    kind: "mcp",
    source: { type: "builtin", location: "https://github.com/microsoft/playwright-mcp" },
    runtime: {
      type: "mcp",
      entry: process.execPath,
      args: [playwrightCli, "--browser", "chrome", "--isolated", "--headless", "--caps", "pdf"],
      requestTimeoutMs: 120_000,
      sessionIdleMs: 300_000,
      maxSessions: 2,
      maxBufferSize: 8_000_000,
    },
    permissions: ["network", "process", "filesystem-read", "filesystem-write"],
    activation: ["打开网页", "点击网页", "填写表单", "浏览器操作", "网页截图", "下载网页"],
    tools: [
      { name: "browser_navigate", description: "在隔离浏览器中打开指定网页。", effect: "read", tags: ["browser", "playwright"] },
      { name: "browser_snapshot", description: "读取当前网页的结构化内容。", effect: "read", tags: ["browser", "playwright"] },
      { name: "browser_click", description: "点击当前网页中的控件。", effect: "write", tags: ["browser", "playwright"] },
      { name: "browser_type", description: "向当前网页输入内容。", effect: "write", tags: ["browser", "playwright"] },
      { name: "browser_take_screenshot", description: "保存当前网页截图。", effect: "write", tags: ["browser", "playwright"] },
    ],
  };
}

function safeAnalysisManifest(): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "analysis.safe-table",
    name: "安全数据分析",
    version: "1.0.0",
    description: "在应用进程内只读分析 CSV 或 JSON 表格，输出字段、缺失值、数值统计和分类分布；不执行用户代码。",
    kind: "agent-app",
    source: { type: "builtin", location: "builtin:analysis.safe-table" },
    runtime: { type: "module", entry: "builtin:analysis.safe-table", requestTimeoutMs: 15_000 },
    permissions: [],
    activation: ["分析CSV", "分析表格", "数据分布", "缺失值", "统计数据", "JSON数据"],
    tools: [{ name: "analyze_table", description: "安全分析 CSV 或 JSON 表格文本。", effect: "read", tags: ["data", "csv", "json"] }],
  };
}

function productivityManifest(): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "productivity.communication-files",
    name: "邮件与日历文件",
    version: "1.0.0",
    description: "读取用户提供的 EML 邮件与 ICS 日历文本，提取发件人、主题、时间、参与者和日程冲突；不连接或修改在线账号。",
    kind: "connector",
    source: { type: "builtin", location: "builtin:productivity.communication-files" },
    runtime: { type: "module", entry: "builtin:productivity.communication-files", requestTimeoutMs: 15_000 },
    permissions: [],
    activation: ["EML", "ICS", "整理邮件", "日历文件", "日程冲突", "会议邀请"],
    tools: [
      { name: "parse_eml_file", description: "解析 EML 邮件文件文本。", effect: "read", tags: ["eml", "message-file"] },
      { name: "parse_ics_file", description: "解析 ICS 日历文件并检查重叠日程。", effect: "read", tags: ["ics", "schedule-file"] },
    ],
  };
}

function mediaManifest(): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "media.generate",
    name: "图像与视频生成",
    version: "1.0.0",
    description: "通过用户配置的 OpenAI 兼容媒体端点生成图像，或创建、查询和下载视频任务；密钥只从本机环境变量读取。",
    kind: "connector",
    source: { type: "builtin", location: "builtin:media.generate" },
    runtime: { type: "module", entry: "builtin:media.generate", requestTimeoutMs: 300_000 },
    permissions: ["network", "filesystem-write"],
    models: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini", "sora-2", "sora-2-pro"],
    activation: ["生成图片", "生成图像", "生成视频", "视频任务", "下载视频"],
    tools: [
      { name: "generate_image", description: "生成图像并保存到本机产物目录。", effect: "write", tags: ["image", "generate"] },
      { name: "create_video", description: "创建视频生成任务并返回任务编号。", effect: "write", tags: ["video", "generate"] },
      { name: "check_video", description: "查询视频生成任务状态。", effect: "read", tags: ["video", "status"] },
      { name: "download_video", description: "下载已完成的视频到本机产物目录。", effect: "write", tags: ["video", "download"] },
    ],
  };
}

function staticProvider(manifest: AgentExtensionManifest, tools: Record<string, AgentTool>): AgentExtensionProvider {
  const descriptors = manifest.tools.map((tool): AgentExtensionToolDescriptor => ({ ...tool, extensionId: manifest.id }));
  return {
    discover: async (query) => {
      const normalized = query.toLowerCase();
      return descriptors.filter((tool) => !normalized || manifest.activation.some((cue) => normalized.includes(cue.toLowerCase())) || tool.tags?.some((tag) => normalized.includes(tag.toLowerCase())));
    },
    loadTool: async (name) => {
      const tool = tools[name];
      if (!tool) throw new Error(`扩展 ${manifest.name} 没有工具 ${name}`);
      return tool;
    },
  };
}

function safeAnalysisTools(): Record<string, AgentTool> {
  return {
    analyze_table: tool("analyze_table", "安全分析 CSV 或 JSON 表格文本。", "read", {
      type: "object",
      properties: { content: { type: "string" }, format: { type: "string", enum: ["auto", "csv", "json"] } },
      required: ["content"],
      additionalProperties: false,
    }, async (input) => ({ content: analyzeTable(String(input.content || ""), String(input.format || "auto")) })),
  };
}

function analyzeTable(content: string, format: string): string {
  if (!content.trim()) throw new Error("没有可分析的数据。");
  if (content.length > 2_000_000) throw new Error("单次分析最多接收 200 万个字符，请先缩小数据范围。");
  const rows = (format === "json" || (format === "auto" && /^[\s\r\n]*[\[{]/.test(content)))
    ? jsonRows(content)
    : csvRows(content);
  if (!rows.length) throw new Error("没有识别到数据行。");
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 200);
  const lines = [`共 ${rows.length} 行，${columns.length} 列。`];
  for (const column of columns) {
    const values = rows.map((row) => row[column]).filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
    const missing = rows.length - values.length;
    const numbers = values.map(Number).filter(Number.isFinite);
    if (numbers.length === values.length && values.length) {
      const sum = numbers.reduce((total, value) => total + value, 0);
      lines.push(`- ${column}：数值；缺失 ${missing}；最小 ${Math.min(...numbers)}；最大 ${Math.max(...numbers)}；平均 ${(sum / numbers.length).toFixed(2)}`);
    } else {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => `${value}(${count})`).join("、");
      lines.push(`- ${column}：文本/分类；缺失 ${missing}；不同值 ${counts.size}${top ? `；常见值 ${top}` : ""}`);
    }
  }
  return lines.join("\n");
}

function jsonRows(content: string): Array<Record<string, unknown>> {
  const value = JSON.parse(content) as unknown;
  const items = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

function csvRows(content: string): Array<Record<string, unknown>> {
  const records = parseCsv(content);
  const headers = records.shift()?.map((item, index) => item.trim() || `列${index + 1}`) ?? [];
  return records.filter((row) => row.some((item) => item.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"' && quoted && content[index + 1] === '"') { cell += '"'; index++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

function productivityTools(): Record<string, AgentTool> {
  return {
    parse_eml_file: tool("parse_eml_file", "解析 EML 邮件文件文本。", "read", textSchema(), async (input) => ({ content: parseEmail(String(input.content || "")) })),
    parse_ics_file: tool("parse_ics_file", "解析 ICS 日历文件并检查重叠日程。", "read", textSchema(), async (input) => ({ content: parseCalendar(String(input.content || "")) })),
  };
}

function textSchema() {
  return { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false };
}

function parseEmail(content: string): string {
  if (content.length > 2_000_000) throw new Error("邮件内容过大。");
  const split = content.split(/\r?\n\r?\n/);
  const headers = unfoldLines(split.shift() ?? "").reduce<Record<string, string>>((result, line) => {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) result[match[1].toLowerCase()] = match[2];
    return result;
  }, {});
  const body = split.join("\n\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [
    `主题：${headers.subject || "（无主题）"}`,
    `发件人：${headers.from || "未知"}`,
    `收件人：${headers.to || "未知"}`,
    `时间：${headers.date || "未知"}`,
    headers.cc ? `抄送：${headers.cc}` : "",
    `正文摘要：${body.slice(0, 4_000) || "（无可读正文）"}`,
  ].filter(Boolean).join("\n");
}

function parseCalendar(content: string): string {
  if (content.length > 2_000_000) throw new Error("日历内容过大。");
  const text = unfoldLines(content).join("\n");
  const events = [...text.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)].map((match) => {
    const fields = Object.fromEntries(match[1].split("\n").map((line) => {
      const divider = line.indexOf(":");
      return divider > 0 ? [line.slice(0, divider).split(";")[0], line.slice(divider + 1)] : [line, ""];
    }));
    return { title: fields.SUMMARY || "未命名日程", start: fields.DTSTART || "", end: fields.DTEND || "", location: fields.LOCATION || "", attendees: match[1].split("\n").filter((line) => line.startsWith("ATTENDEE")).length };
  });
  const conflicts: string[] = [];
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < sorted.length; index++) if (sorted[index - 1].end && sorted[index].start < sorted[index - 1].end) conflicts.push(`${sorted[index - 1].title} ↔ ${sorted[index].title}`);
  return [
    `共 ${events.length} 个日程。`,
    ...events.slice(0, 100).map((event) => `- ${event.title}｜${event.start || "时间未知"}—${event.end || "结束未知"}${event.location ? `｜${event.location}` : ""}${event.attendees ? `｜${event.attendees} 位参与者` : ""}`),
    conflicts.length ? `\n发现可能冲突：${conflicts.join("；")}` : "\n未发现明确的时间重叠。",
  ].join("\n");
}

function unfoldLines(content: string): string[] {
  return content.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function mediaTools(dataDir: string): Record<string, AgentTool> {
  return {
    generate_image: tool("generate_image", "生成图像并保存到本机。", "write", {
      type: "object",
      properties: { prompt: { type: "string" }, size: { type: "string" }, quality: { type: "string" }, model: { type: "string" } },
      required: ["prompt"], additionalProperties: false,
    }, async (input, signal) => generateImage(input, dataDir, signal)),
    create_video: tool("create_video", "创建视频生成任务。", "write", {
      type: "object",
      properties: { prompt: { type: "string" }, size: { type: "string" }, seconds: { type: "string" }, model: { type: "string" } },
      required: ["prompt"], additionalProperties: false,
    }, async (input, signal) => createVideo(input, signal)),
    check_video: tool("check_video", "查询视频任务，完成后下载到本机。", "read", {
      type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false,
    }, async (input, signal) => checkVideo(input, signal)),
    download_video: tool("download_video", "下载已完成的视频到本机。", "write", {
      type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false,
    }, async (input, signal) => downloadVideo(input, dataDir, signal)),
  };
}

function mediaConfig() {
  const baseUrl = String(process.env.NEMOS_MEDIA_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = String(process.env.NEMOS_MEDIA_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("尚未配置媒体生成密钥。请设置 NEMOS_MEDIA_API_KEY，或使用 OPENAI_API_KEY。");
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(baseUrl)) throw new Error("媒体服务地址必须使用 HTTPS，或指向本机服务。");
  return { baseUrl, apiKey };
}

async function generateImage(input: Record<string, unknown>, dataDir: string, signal: AbortSignal) {
  const config = mediaConfig();
  const response = await fetch(`${config.baseUrl}/images/generations`, {
    method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: String(input.model || process.env.NEMOS_IMAGE_MODEL || "gpt-image-2"), prompt: String(input.prompt || ""), size: String(input.size || "1024x1024"), quality: String(input.quality || "auto"), response_format: "b64_json" }),
  });
  const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `图像服务返回 ${response.status}`);
  const item = body.data?.[0];
  if (!item?.b64_json && !item?.url) throw new Error("图像服务没有返回可保存的结果。");
  const directory = resolve(dataDir, "generated-media");
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `image-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
  if (item.b64_json) writeFileSync(file, Buffer.from(item.b64_json, "base64"));
  else {
    const download = await fetch(item.url!, { signal });
    if (!download.ok) throw new Error(`图像下载失败：${download.status}`);
    writeFileSync(file, Buffer.from(await download.arrayBuffer()));
  }
  return { content: `图像已生成并保存：${file}`, data: { file } };
}

async function createVideo(input: Record<string, unknown>, signal: AbortSignal) {
  const config = mediaConfig();
  const form = new FormData();
  form.set("model", String(input.model || process.env.NEMOS_VIDEO_MODEL || "sora-2"));
  form.set("prompt", String(input.prompt || ""));
  form.set("seconds", String(input.seconds || "4"));
  form.set("size", String(input.size || "1280x720"));
  const response = await fetch(`${config.baseUrl}/videos`, { method: "POST", signal, headers: { Authorization: `Bearer ${config.apiKey}` }, body: form });
  const body = await response.json() as { id?: string; status?: string; error?: { message?: string } };
  if (!response.ok || !body.id) throw new Error(body.error?.message || `视频服务返回 ${response.status}`);
  return { content: `视频任务已创建：${body.id}（${body.status || "queued"}）。稍后用“查询视频任务”继续。`, data: body };
}

async function checkVideo(input: Record<string, unknown>, signal: AbortSignal) {
  const config = mediaConfig();
  const id = String(input.id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new Error("视频任务编号无效。");
  const response = await fetch(`${config.baseUrl}/videos/${encodeURIComponent(id)}`, { signal, headers: { Authorization: `Bearer ${config.apiKey}` } });
  const body = await response.json() as { id?: string; status?: string; progress?: number; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `视频服务返回 ${response.status}`);
  return { content: `视频任务 ${id}：${body.status || "unknown"}${Number.isFinite(body.progress) ? `，进度 ${body.progress}%` : ""}`, data: body };
}

async function downloadVideo(input: Record<string, unknown>, dataDir: string, signal: AbortSignal) {
  const config = mediaConfig();
  const id = String(input.id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new Error("视频任务编号无效。");
  const download = await fetch(`${config.baseUrl}/videos/${encodeURIComponent(id)}/content`, { signal, headers: { Authorization: `Bearer ${config.apiKey}` } });
  if (!download.ok) throw new Error(`视频下载失败：${download.status}`);
  const directory = resolve(dataDir, "generated-media");
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `video-${id}.mp4`);
  writeFileSync(file, Buffer.from(await download.arrayBuffer()));
  return { content: `视频已完成并保存：${file}`, data: { id, file } };
}

function tool(
  name: string,
  description: string,
  effect: "read" | "write",
  inputSchema: Record<string, unknown>,
  execute: (input: Record<string, unknown>, signal: AbortSignal) => Promise<{ content: string; data?: unknown }>,
): AgentTool {
  return {
    definition: { name, description, inputSchema, effect, timeoutMs: effect === "write" ? 300_000 : 30_000 },
    execute: async (input, context) => execute(input, context.signal),
  };
}
