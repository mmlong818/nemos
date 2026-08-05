import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export interface WeChatPrivateSourceConfig {
  enabled: boolean;
  inboxDir: string;
  watchDirs: string[];
}

export interface XPrivateSourceConfig {
  enabled: boolean;
  usernames: string[];
  queries: string[];
  oauthClientId?: string;
  homeTimelineUserId?: string;
  homeTimelineEnabled?: boolean;
}

export interface PrivateSourcesConfig {
  wechat: WeChatPrivateSourceConfig;
  x: XPrivateSourceConfig;
}

export interface PrivateSourcesSummary {
  configFile: string;
  wechat: {
    enabled: boolean;
    inboxDir: string;
    watchDirs: string[];
    recentFiles: number;
  };
  x: {
    enabled: boolean;
    hasBearerToken: boolean;
    hasUserAccessToken: boolean;
    hasRefreshToken: boolean;
    usernames: string[];
    queries: string[];
    oauthClientId?: string;
    homeTimelineUserId?: string;
    homeTimelineEnabled: boolean;
  };
}

export interface WeChatImportInput {
  title?: string;
  text?: string;
  url?: string;
  source?: string;
}

const DEFAULT_X_USERNAMES = [
  "OpenAI",
  "AnthropicAI",
  "GoogleDeepMind",
  "MistralAI",
  "AIatMeta",
  "huggingface",
  "GitHub",
  "vercel",
  "cursor_ai",
  "perplexity_ai",
];

const SOURCE_EXTENSIONS = new Set([".txt", ".md", ".json", ".html", ".htm", ".url"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function loadPrivateSourcesConfig(dataDir: string): PrivateSourcesConfig {
  const file = privateSourcesConfigFile(dataDir);
  const fallback = defaultPrivateSourcesConfig(dataDir);
  try {
    if (!existsSync(file)) {
      savePrivateSourcesConfig(dataDir, fallback);
      return fallback;
    }
    const raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Partial<PrivateSourcesConfig>;
    return normalizePrivateSourcesConfig(dataDir, raw);
  } catch {
    return fallback;
  }
}

export function savePrivateSourcesConfig(dataDir: string, input: Partial<PrivateSourcesConfig>): PrivateSourcesConfig {
  const config = normalizePrivateSourcesConfig(dataDir, input);
  mkdirSync(privateSourcesDir(dataDir), { recursive: true });
  mkdirSync(config.wechat.inboxDir, { recursive: true });
  writeFileSync(privateSourcesConfigFile(dataDir), JSON.stringify(config, null, 2), "utf8");
  return config;
}

export function privateSourcesSummary(dataDir: string): PrivateSourcesSummary {
  const config = loadPrivateSourcesConfig(dataDir);
  return {
    configFile: privateSourcesConfigFile(dataDir),
    wechat: {
      enabled: config.wechat.enabled,
      inboxDir: config.wechat.inboxDir,
      watchDirs: config.wechat.watchDirs,
      recentFiles: collectRecentPrivateFiles(config).length,
    },
    x: {
      enabled: config.x.enabled,
      hasBearerToken: !!process.env.X_BEARER_TOKEN,
      hasUserAccessToken: !!process.env.X_USER_ACCESS_TOKEN,
      hasRefreshToken: !!process.env.X_REFRESH_TOKEN,
      usernames: config.x.usernames,
      queries: config.x.queries,
      oauthClientId: config.x.oauthClientId,
      homeTimelineUserId: config.x.homeTimelineUserId,
      homeTimelineEnabled: !!config.x.homeTimelineEnabled,
    },
  };
}

export function importWeChatPrivateSource(dataDir: string, input: WeChatImportInput): { file: string; title: string } {
  const config = loadPrivateSourcesConfig(dataDir);
  const title = text(input.title || input.source || "微信私域素材", "微信私域素材", 80);
  const now = new Date();
  const file = join(config.wechat.inboxDir, `${dateStamp(now)}-${safeFileName(title)}.md`);
  const body = [
    `# ${title}`,
    "",
    `- 导入时间：${now.toISOString()}`,
    input.source ? `- 来源：${input.source}` : "",
    input.url ? `- 链接：${input.url}` : "",
    "",
    input.text || "（空内容）",
  ].filter(Boolean).join("\n");
  mkdirSync(config.wechat.inboxDir, { recursive: true });
  writeFileSync(file, body, "utf8");
  return { file, title };
}

export async function buildPrivateSourcePromptBlock(dataDir: string, instruction: string): Promise<string> {
  if (!shouldAttachPrivateSources(instruction)) return "";
  const config = loadPrivateSourcesConfig(dataDir);
  const since = new Date(Date.now() - DAY_MS);
  const sections: string[] = [
    "Private source connectors for this task:",
    `- WeChat private inbox: ${config.wechat.enabled ? "enabled" : "disabled"}; path=${config.wechat.inboxDir}`,
    `- X configured accounts: ${config.x.enabled ? config.x.usernames.join(", ") || "(none)" : "disabled"}`,
  ];

  const wechatItems = config.wechat.enabled ? collectWeChatItems(config, since) : [];
  if (wechatItems.length > 0) {
    sections.push("", "WeChat private-source items from the last 24 hours:");
    sections.push(...wechatItems.slice(0, 18).map(formatFileItem));
  } else {
    sections.push("", "WeChat private-source status: no inbox/watch-dir files from the last 24 hours. Use this as a real gap; do not pretend to have read WeChat chats.");
  }

  const xBlock = config.x.enabled ? await collectXBlock(config, since) : "X source status: connector disabled.";
  sections.push("", xBlock);

  sections.push(
    "",
    "Private-source evidence rules:",
    "- Treat WeChat inbox/watch-dir items as user-provided private material, not public proof.",
    "- Treat X API results as platform-source leads unless they are official company/project accounts.",
    "- If no token or no fresh items are available, explicitly say the source is not connected or has no fresh items.",
  );
  return sections.join("\n");
}

function privateSourcesDir(dataDir: string): string {
  return join(dataDir, "sources");
}

function privateSourcesConfigFile(dataDir: string): string {
  return join(privateSourcesDir(dataDir), "private-sources.json");
}

function defaultPrivateSourcesConfig(dataDir: string): PrivateSourcesConfig {
  return {
    wechat: {
      enabled: true,
      inboxDir: join(privateSourcesDir(dataDir), "wechat-inbox"),
      watchDirs: [],
    },
    x: {
      enabled: true,
      usernames: DEFAULT_X_USERNAMES,
      queries: [],
      oauthClientId: undefined,
      homeTimelineEnabled: false,
    },
  };
}

function normalizePrivateSourcesConfig(dataDir: string, input: Partial<PrivateSourcesConfig>): PrivateSourcesConfig {
  const fallback = defaultPrivateSourcesConfig(dataDir);
  const wechat = input.wechat ?? {};
  const x = input.x ?? {};
  const config: PrivateSourcesConfig = {
    wechat: {
      enabled: wechat.enabled ?? fallback.wechat.enabled,
      inboxDir: safeDir(wechat.inboxDir || fallback.wechat.inboxDir),
      watchDirs: Array.isArray(wechat.watchDirs) ? wechat.watchDirs.map(safeDir).filter(Boolean).slice(0, 12) : [],
    },
    x: {
      enabled: x.enabled ?? fallback.x.enabled,
      usernames: normalizeList(x.usernames, fallback.x.usernames, 40).map(normalizeXUsername).filter(Boolean),
      queries: normalizeList(x.queries, [], 20),
      oauthClientId: x.oauthClientId ? String(x.oauthClientId).trim().slice(0, 160) : undefined,
      homeTimelineUserId: x.homeTimelineUserId ? String(x.homeTimelineUserId).trim().slice(0, 80) : undefined,
      homeTimelineEnabled: !!x.homeTimelineEnabled,
    },
  };
  mkdirSync(config.wechat.inboxDir, { recursive: true });
  return config;
}

function safeDir(value: string): string {
  return resolve(String(value || "").trim());
}

function normalizeList(value: unknown, fallback: string[], max: number): string[] {
  const arr = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(arr.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, max);
}

function normalizeXUsername(value: string): string {
  return value.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30);
}

function shouldAttachPrivateSources(instruction: string): boolean {
  return /(AI|模型|开源|产品|公司动态|微信|公众号|私域|X|Twitter|推特|timeline|时间线|重要事件|简报)/i.test(instruction);
}

interface FileItem {
  source: "wechat-private" | "private-watch";
  file: string;
  title: string;
  modifiedAt: string;
  excerpt: string;
}

function collectRecentPrivateFiles(config: PrivateSourcesConfig): FileItem[] {
  return collectWeChatItems(config, new Date(Date.now() - DAY_MS));
}

function collectWeChatItems(config: PrivateSourcesConfig, since: Date): FileItem[] {
  const dirs = [
    { dir: config.wechat.inboxDir, source: "wechat-private" as const },
    ...config.wechat.watchDirs.map((dir) => ({ dir, source: "private-watch" as const })),
  ];
  const out: FileItem[] = [];
  for (const entry of dirs) {
    if (!existsSync(entry.dir)) continue;
    for (const file of listFiles(entry.dir, 2)) {
      if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
      let stat;
      try { stat = statSync(file); } catch { continue; }
      if (!stat.isFile() || stat.mtime < since) continue;
      const raw = safeRead(file);
      if (!raw.trim()) continue;
      out.push({
        source: entry.source,
        file,
        title: inferTitle(file, raw),
        modifiedAt: stat.mtime.toISOString(),
        excerpt: excerpt(raw, 900),
      });
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 40);
}

function listFiles(dir: string, depth: number): string[] {
  let out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile()) out.push(full);
    else if (entry.isDirectory() && depth > 0 && !entry.name.startsWith(".")) out = out.concat(listFiles(full, depth - 1));
  }
  return out;
}

function safeRead(file: string): string {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 2_000_000) return "";
    return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function inferTitle(file: string, raw: string): string {
  const firstHeading = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim();
  return text(firstHeading || basename(file, extname(file)), "私域素材", 120);
}

function formatFileItem(item: FileItem): string {
  return [
    `- [${item.source}] ${item.title}`,
    `  modified_at: ${item.modifiedAt}`,
    `  file: ${item.file}`,
    `  excerpt: ${item.excerpt}`,
  ].join("\n");
}

async function collectXBlock(config: PrivateSourcesConfig, since: Date): Promise<string> {
  const lines: string[] = [];
  const bearer = process.env.X_BEARER_TOKEN;
  const userToken = process.env.X_USER_ACCESS_TOKEN;
  if (!bearer && !userToken) {
    return "X source status: no X token configured. Set X Bearer Token for configured public accounts, or OAuth user access token plus user id for home timeline.";
  }

  const posts: string[] = [];
  const warnings: string[] = [];

  if (bearer) {
    for (const username of config.x.usernames.slice(0, 16)) {
      try {
        const user = await xGet<{ data?: { id: string; name?: string; username?: string } }>(
          `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=name,username,verified`,
          bearer,
        );
        const id = user.data?.id;
        if (!id) {
          warnings.push(`@${username}: user not found`);
          continue;
        }
        const url = new URL(`https://api.x.com/2/users/${id}/tweets`);
        url.searchParams.set("max_results", "10");
        url.searchParams.set("start_time", since.toISOString());
        url.searchParams.set("exclude", "replies");
        url.searchParams.set("tweet.fields", "created_at,public_metrics,entities,referenced_tweets,lang");
        const data = await xGet<{ data?: XPost[] }>(url.toString(), bearer);
        for (const post of data.data ?? []) posts.push(formatXPost(username, post));
      } catch (e) {
        warnings.push(`@${username}: ${errorText(e)}`);
      }
    }
  }

  if (config.x.homeTimelineEnabled && config.x.homeTimelineUserId && userToken) {
    try {
      const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(config.x.homeTimelineUserId)}/timelines/reverse_chronological`);
      url.searchParams.set("max_results", "20");
      url.searchParams.set("start_time", since.toISOString());
      url.searchParams.set("tweet.fields", "created_at,public_metrics,entities,referenced_tweets,author_id,lang");
      const data = await xGet<{ data?: XPost[] }>(url.toString(), userToken);
      for (const post of data.data ?? []) posts.push(formatXPost("home-timeline", post));
    } catch (e) {
      warnings.push(`home timeline: ${errorText(e)}`);
    }
  } else if (config.x.homeTimelineEnabled) {
    warnings.push("home timeline enabled but X_USER_ACCESS_TOKEN or homeTimelineUserId is missing");
  }

  lines.push("X source status:");
  lines.push(`- configured_account_timeline: ${bearer ? "token configured" : "missing bearer token"}`);
  lines.push(`- home_timeline: ${config.x.homeTimelineEnabled ? (userToken ? "user token configured" : "missing user token") : "disabled"}`);
  if (posts.length > 0) {
    lines.push("", "X posts from the last 24 hours:");
    lines.push(...posts.slice(0, 45));
  } else {
    lines.push("", "No X posts were fetched from configured sources in the last 24 hours.");
  }
  if (warnings.length > 0) {
    lines.push("", "X connector warnings:");
    lines.push(...warnings.slice(0, 20).map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

interface XPost {
  id: string;
  text?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: Record<string, number>;
}

async function xGet<T>(url: string, token: string): Promise<T> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Clownfish/0.1",
  };
  let status = 0;
  let ok = false;
  let body = "";
  try {
    const resp = await fetch(url, { headers });
    status = resp.status;
    ok = resp.ok;
    body = await resp.text();
  } catch {
    const ps = xRequestViaPowerShell(url, headers);
    status = ps.status;
    ok = ps.ok;
    body = ps.body;
  }
  if (!ok) throw new Error(`HTTP ${status}: ${body.slice(0, 180)}`);
  return JSON.parse(body) as T;
}

function xRequestViaPowerShell(url: string, headers: Record<string, string>): { ok: boolean; status: number; body: string } {
  const script = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$headers = @{}
foreach ($p in $payload.headers.PSObject.Properties) { $headers[$p.Name] = [string]$p.Value }
try {
  $resp = Invoke-WebRequest -Uri ([string]$payload.url) -Method Get -Headers $headers -UseBasicParsing -TimeoutSec 30
  [Console]::Out.Write((@{ ok = $true; status = [int]$resp.StatusCode; body = [string]$resp.Content } | ConvertTo-Json -Compress -Depth 5))
} catch [System.Net.WebException] {
  $status = 0
  $body = $_.Exception.Message
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
  }
  [Console]::Out.Write((@{ ok = $false; status = $status; body = [string]$body } | ConvertTo-Json -Compress -Depth 5))
}
`;
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: JSON.stringify({ url, headers }),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok?: boolean; status?: number; body?: string };
  return { ok: !!parsed.ok, status: Number(parsed.status || 0), body: parsed.body ?? "" };
}

function formatXPost(username: string, post: XPost): string {
  const metrics = post.public_metrics
    ? Object.entries(post.public_metrics).map(([k, v]) => `${k}=${v}`).join(", ")
    : "metrics=n/a";
  const url = username === "home-timeline" ? `https://x.com/i/web/status/${post.id}` : `https://x.com/${username}/status/${post.id}`;
  return [
    `- [x:${username}] ${post.created_at || "unknown time"} ${url}`,
    `  metrics: ${metrics}`,
    `  text: ${excerpt(post.text || "", 420)}`,
  ].join("\n");
}

function text(value: string, fallback: string, max: number): string {
  const out = value.trim() || fallback;
  return out.slice(0, max);
}

function excerpt(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "source";
}

function dateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
