// 检查新版本：只在用户同意后读取 GitHub 上最新发布的版本号，请求不带账号、使用数据或本机内容。
// 用户没回答之前 enabled 为 null，此时一个请求都不发（隐私协议：新增数据外发须先向用户展示）。
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const RELEASES_API = "https://api.github.com/repos/mmlong818/nemos/releases/latest";
export const RELEASES_PAGE = "https://github.com/mmlong818/nemos/releases";
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface LatestRelease {
  readonly version: string;
  readonly url: string;
  readonly name?: string;
  readonly publishedAt?: string;
}

export interface AppUpdateState {
  enabled: boolean | null;
  checkedAt?: string;
  latest?: LatestRelease;
  lastError?: string;
}

export interface PublicAppUpdate {
  readonly enabled: boolean | null;
  readonly current: string;
  readonly available: boolean;
  readonly latest?: LatestRelease;
  readonly checkedAt?: string;
  readonly lastError?: string;
  readonly releasesUrl: string;
}

/** 比较 x.y.z；数字部分相同时，带预发布后缀（-beta）的版本更旧。 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = "", pre = ""] = value.trim().replace(/^v/i, "").split("-", 2);
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre };
  };
  const left = parse(a), right = parse(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index++) {
    const diff = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (diff) return Math.sign(diff);
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** GitHub releases/latest 的响应；草稿、预发布和非本仓库链接一律不采信。 */
export function parseLatestRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.draft === true || record.prerelease === true) return null;
  const tag = typeof record.tag_name === "string" ? record.tag_name.trim() : "";
  if (!/^v?\d+\.\d+(\.\d+)?(-[0-9A-Za-z.]+)?$/.test(tag)) return null;
  const htmlUrl = typeof record.html_url === "string" ? record.html_url : "";
  return {
    version: tag.replace(/^v/i, ""),
    url: htmlUrl.startsWith(`${RELEASES_PAGE}/`) ? htmlUrl : RELEASES_PAGE,
    ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim().slice(0, 120) } : {}),
    ...(typeof record.published_at === "string" ? { publishedAt: record.published_at } : {}),
  };
}

export class AppUpdateChecker {
  private state: AppUpdateState;
  private inflight: Promise<void> | undefined;

  constructor(
    private readonly file: string,
    private readonly currentVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.state = this.load();
  }

  status(): PublicAppUpdate {
    const latest = this.state.enabled === true ? this.state.latest : undefined;
    return {
      enabled: this.state.enabled,
      current: this.currentVersion,
      available: Boolean(latest && compareVersions(latest.version, this.currentVersion) > 0),
      ...(latest ? { latest } : {}),
      ...(this.state.checkedAt ? { checkedAt: this.state.checkedAt } : {}),
      ...(this.state.lastError ? { lastError: this.state.lastError } : {}),
      releasesUrl: RELEASES_PAGE,
    };
  }

  /** 页面每次打开都会问一次；只有已同意且距上次检查超过间隔时才真正联网。 */
  async refreshIfDue(): Promise<PublicAppUpdate> {
    if (this.state.enabled !== true) return this.status();
    const last = this.state.checkedAt ? Date.parse(this.state.checkedAt) : Number.NaN;
    if (Number.isFinite(last) && this.now() - last < UPDATE_CHECK_INTERVAL_MS) return this.status();
    await this.check();
    return this.status();
  }

  async setEnabled(enabled: boolean): Promise<PublicAppUpdate> {
    this.state = enabled ? { ...this.state, enabled } : { enabled };
    this.save();
    if (enabled) await this.check();
    return this.status();
  }

  private check(): Promise<void> {
    this.inflight ??= this.fetchLatest().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async fetchLatest(): Promise<void> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const response = await this.fetchImpl(RELEASES_API, {
        headers: { accept: "application/vnd.github+json", "user-agent": "Clownfish-Update-Check" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // 404：仓库还没有任何正式发布，不算错误。
      if (response.status === 404) {
        this.state = { enabled: this.state.enabled, checkedAt };
      } else if (!response.ok) {
        this.state = { ...this.state, checkedAt, lastError: `GitHub 返回 HTTP ${response.status}` };
      } else {
        const latest = parseLatestRelease(await response.json());
        this.state = { enabled: this.state.enabled, checkedAt, ...(latest ? { latest } : {}) };
      }
    } catch (error) {
      this.state = { ...this.state, checkedAt, lastError: error instanceof Error && error.name === "TimeoutError" ? "连接 GitHub 超时" : "暂时连不上 GitHub" };
    }
    this.save();
  }

  private load(): AppUpdateState {
    try {
      if (!existsSync(this.file)) return { enabled: null };
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<AppUpdateState>;
      const latest = raw.latest && typeof raw.latest.version === "string" && typeof raw.latest.url === "string" && raw.latest.url.startsWith(RELEASES_PAGE)
        ? raw.latest : undefined;
      return {
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
        ...(typeof raw.checkedAt === "string" ? { checkedAt: raw.checkedAt } : {}),
        ...(latest ? { latest } : {}),
        ...(typeof raw.lastError === "string" ? { lastError: raw.lastError } : {}),
      };
    } catch {
      return { enabled: null };
    }
  }

  private save(): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    renameSync(temporary, this.file);
  }
}
