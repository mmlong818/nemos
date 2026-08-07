import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HKEX_DIRECTORY_URL = "https://www1.hkexnews.hk/ncms/script/eds/activestock_sehk_e.json";
const HKEX_SEARCH_URL = "https://www1.hkexnews.hk/search/titlesearch.xhtml";
const TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q";
const WATCHLIST_VERSION = 1;
const MAX_SYMBOLS = 8;

type FetchLike = typeof globalThis.fetch;

export interface MarketWatchItem {
  symbol: string;
  name?: string;
  addedAt: string;
}

export interface MarketQuoteSnapshot {
  symbol: string;
  providerSymbol: string;
  name?: string;
  currency?: string;
  exchange?: string;
  marketState?: string;
  price?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  asOf?: string;
  queriedAt: string;
  sourceUrl: string;
  sourceQuality: "third-party-snapshot";
  delayStatus: "provider-not-declared";
}

export interface MarketAnnouncement {
  symbol: string;
  releasedAt: string;
  company: string;
  category: string;
  title: string;
  url: string;
  sourceQuality: "official-disclosure";
}

export interface MarketSymbolSnapshot {
  symbol: string;
  name?: string;
  quote?: MarketQuoteSnapshot;
  announcements: MarketAnnouncement[];
  errors: string[];
}

export interface MarketSnapshot {
  queriedAt: string;
  symbols: MarketSymbolSnapshot[];
  sourceNotes: string[];
}

export interface MarketDataAdapter {
  listWatchlist(): Promise<MarketWatchItem[]>;
  addWatchItem(input: { symbol: string; name?: string }): Promise<MarketWatchItem[]>;
  removeWatchItem(symbol: string): Promise<MarketWatchItem[]>;
  snapshot(input?: { symbols?: string[]; announcementLimit?: number }, signal?: AbortSignal): Promise<MarketSnapshot>;
}

interface HkexDirectoryItem {
  i: number;
  c: string;
  n: string;
}

interface WatchlistDocument {
  version: number;
  updatedAt: string;
  items: MarketWatchItem[];
}

export function normalizeHongKongSymbol(value: string): { symbol: string; providerSymbol: string } {
  const trimmed = String(value || "").trim().toUpperCase();
  const match = trimmed.match(/^(?:HKEX:)?(\d{1,5})(?:\.HK)?$/);
  if (!match) throw new Error(`不支持的港股代码：${trimmed || "空值"}`);
  const symbol = match[1].padStart(5, "0");
  return { symbol, providerSymbol: `${symbol.slice(1)}.HK` };
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(nbsp|amp|quot|apos|lt|gt));/gi, (_match, decimal, hex, name) => {
    if (name) return named[String(name).toLowerCase()] ?? "";
    const code = hex ? Number.parseInt(hex, 16) : Number(decimal);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function htmlText(value: string): string {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, " / ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s\/\s)+$/g, "")
    .trim();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rounded(value: number | undefined, digits = 4): number | undefined {
  if (value === undefined) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function parseHkexAnnouncements(html: string, symbol: string, limit = 3): MarketAnnouncement[] {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const announcements: MarketAnnouncement[] = [];
  for (const row of rows) {
    const href = row.match(/<div[^>]*class="[^"]*doc-link[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!href) continue;
    const released = row.match(/<td[^>]*class="[^"]*release-time[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const company = row.match(/<td[^>]*class="[^"]*stock-short-name[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const headline = row.match(/<div[^>]*class="[^"]*headline[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const url = new URL(href[1], "https://www1.hkexnews.hk").toString();
    announcements.push({
      symbol,
      releasedAt: htmlText(released?.[1] ?? "").replace(/^Release Time:\s*/i, ""),
      company: htmlText(company?.[1] ?? "").replace(/^Stock Short Name:\s*/i, ""),
      category: htmlText(headline?.[1] ?? ""),
      title: htmlText(href[2]),
      url,
      sourceQuality: "official-disclosure",
    });
    if (announcements.length >= Math.max(1, Math.min(10, limit))) break;
  }
  return announcements;
}

export function buildMarketSnapshotText(snapshot: MarketSnapshot): string {
  const lines = [
    `市场资料查询时间：${snapshot.queriedAt}`,
    "用途：资料简报与风险核验，不构成投资建议。",
  ];
  for (const item of snapshot.symbols) {
    lines.push("", `## ${item.symbol}${item.name ? ` ${item.name}` : ""}`);
    if (item.quote) {
      const quote = item.quote;
      const change = quote.change === undefined ? "未知" : `${quote.change >= 0 ? "+" : ""}${quote.change}`;
      const percent = quote.changePercent === undefined ? "未知" : `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent}%`;
      lines.push(
        `- 行情快照：${quote.price ?? "未知"} ${quote.currency ?? ""}；较前收 ${change}（${percent}）`,
        `- 行情时间：${quote.asOf ?? "提供方未返回"}；市场状态：${quote.marketState ?? "未知"}`,
        `- 行情来源：腾讯行情公开快照（第三方快照，延迟状态未声明） ${quote.sourceUrl}`,
      );
    } else {
      lines.push("- 行情快照：未取得");
    }
    if (item.announcements.length) {
      lines.push("- 港交所公告：");
      for (const announcement of item.announcements) {
        lines.push(`  - ${announcement.releasedAt}｜${announcement.category}｜${announcement.title}｜${announcement.url}`);
      }
    } else {
      lines.push("- 港交所公告：未取得");
    }
    if (item.errors.length) lines.push(...item.errors.map((message) => `- 待核验：${message}`));
  }
  lines.push("", ...snapshot.sourceNotes.map((note) => `- 来源说明：${note}`));
  return lines.join("\n");
}

export function createMarketDataAdapter(options: {
  dataDir: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
}): MarketDataAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = Math.max(2_000, options.timeoutMs ?? 20_000);
  const watchlistFile = join(options.dataDir, "capabilities", "market-watchlist.json");
  let directoryCache: { expiresAt: number; items: HkexDirectoryItem[] } | undefined;

  const request = async (url: string, accept: string, signal?: AbortSignal): Promise<Response> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("市场资料请求超时")), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`市场资料来源返回 HTTP ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const loadDirectory = async (signal?: AbortSignal): Promise<HkexDirectoryItem[]> => {
    if (directoryCache && directoryCache.expiresAt > Date.now()) return directoryCache.items;
    const response = await request(HKEX_DIRECTORY_URL, "application/json", signal);
    const raw = await response.json() as unknown;
    if (!Array.isArray(raw)) throw new Error("港交所股票目录格式异常");
    const items = raw.filter((item): item is HkexDirectoryItem => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<HkexDirectoryItem>;
      return typeof value.i === "number" && typeof value.c === "string" && typeof value.n === "string";
    });
    directoryCache = { items, expiresAt: Date.now() + 6 * 60 * 60_000 };
    return items;
  };

  const readWatchlist = async (): Promise<WatchlistDocument> => {
    try {
      const parsed = JSON.parse(await readFile(watchlistFile, "utf8")) as Partial<WatchlistDocument>;
      const items = Array.isArray(parsed.items)
        ? parsed.items.flatMap((item) => {
          try {
            const normalized = normalizeHongKongSymbol(String(item?.symbol ?? ""));
            return [{ symbol: normalized.symbol, name: item?.name ? String(item.name).slice(0, 80) : undefined, addedAt: String(item?.addedAt || now().toISOString()) }];
          } catch {
            return [];
          }
        })
        : [];
      return { version: WATCHLIST_VERSION, updatedAt: String(parsed.updatedAt || now().toISOString()), items };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: WATCHLIST_VERSION, updatedAt: now().toISOString(), items: [] };
      }
      throw error;
    }
  };

  const saveWatchlist = async (items: MarketWatchItem[]): Promise<MarketWatchItem[]> => {
    await mkdir(join(options.dataDir, "capabilities"), { recursive: true });
    const document: WatchlistDocument = { version: WATCHLIST_VERSION, updatedAt: now().toISOString(), items };
    const temporary = `${watchlistFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(document, null, 2), "utf8");
    await rename(temporary, watchlistFile);
    return items;
  };

  const fetchQuote = async (symbol: string, providerSymbol: string, name: string | undefined, signal?: AbortSignal): Promise<MarketQuoteSnapshot> => {
    const url = `${TENCENT_QUOTE_URL}?q=r_hk${symbol}`;
    const response = await request(url, "text/plain", signal);
    const raw = new TextDecoder("gbk").decode(await response.arrayBuffer());
    const encoded = raw.match(/="([\s\S]*?)"/)?.[1];
    if (!encoded) throw new Error(`${symbol} 行情返回格式异常`);
    const fields = encoded.split("~");
    if (fields.length < 38) throw new Error(`${symbol} 行情字段不完整`);
    const price = finiteNumber(Number(fields[3]));
    const previousClose = finiteNumber(Number(fields[4]));
    const change = finiteNumber(Number(fields[31])) ?? (price !== undefined && previousClose !== undefined ? price - previousClose : undefined);
    const changePercent = finiteNumber(Number(fields[32])) ?? (change !== undefined && previousClose ? (change / previousClose) * 100 : undefined);
    const timestamp = fields[30]?.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    const asOf = timestamp ? new Date(`${timestamp[1]}-${timestamp[2]}-${timestamp[3]}T${timestamp[4]}+08:00`).toISOString() : undefined;
    return {
      symbol,
      providerSymbol,
      name: String(fields[1] || fields[48] || name || "").trim() || undefined,
      currency: "HKD",
      exchange: "HKG",
      price: rounded(price),
      previousClose: rounded(previousClose),
      change: rounded(change),
      changePercent: rounded(changePercent, 2),
      open: rounded(finiteNumber(Number(fields[5]))),
      high: rounded(finiteNumber(Number(fields[33]))),
      low: rounded(finiteNumber(Number(fields[34]))),
      volume: finiteNumber(Number(fields[6])),
      asOf,
      queriedAt: now().toISOString(),
      sourceUrl: url,
      sourceQuality: "third-party-snapshot",
      delayStatus: "provider-not-declared",
    };
  };

  const fetchAnnouncements = async (directoryItem: HkexDirectoryItem, limit: number, signal?: AbortSignal): Promise<MarketAnnouncement[]> => {
    const query = new URLSearchParams({ lang: "EN", market: "SEHK", category: "0", stockId: String(directoryItem.i) });
    const response = await request(`${HKEX_SEARCH_URL}?${query.toString()}`, "text/html", signal);
    return parseHkexAnnouncements(await response.text(), directoryItem.c, limit);
  };

  return {
    async listWatchlist() {
      return (await readWatchlist()).items;
    },

    async addWatchItem(input) {
      const normalized = normalizeHongKongSymbol(input.symbol);
      const document = await readWatchlist();
      const existing = document.items.find((item) => item.symbol === normalized.symbol);
      const item: MarketWatchItem = {
        symbol: normalized.symbol,
        name: input.name?.trim().slice(0, 80) || existing?.name,
        addedAt: existing?.addedAt || now().toISOString(),
      };
      const items = [...document.items.filter((entry) => entry.symbol !== item.symbol), item].slice(-MAX_SYMBOLS);
      return saveWatchlist(items);
    },

    async removeWatchItem(symbol) {
      const normalized = normalizeHongKongSymbol(symbol);
      const document = await readWatchlist();
      return saveWatchlist(document.items.filter((item) => item.symbol !== normalized.symbol));
    },

    async snapshot(input = {}, signal) {
      const requested = (input.symbols ?? []).map((symbol) => normalizeHongKongSymbol(symbol));
      const fallback = requested.length ? [] : (await readWatchlist()).items.map((item) => normalizeHongKongSymbol(item.symbol));
      const unique = [...new Map([...requested, ...fallback].map((item) => [item.symbol, item])).values()].slice(0, MAX_SYMBOLS);
      if (!unique.length) throw new Error("市场关注列表为空，请提供至少一个港股代码");
      const directory = await loadDirectory(signal);
      const announcementLimit = Math.max(1, Math.min(10, Number(input.announcementLimit || 3)));
      const queriedAt = now().toISOString();
      const symbols = await Promise.all(unique.map(async (normalized): Promise<MarketSymbolSnapshot> => {
        const directoryItem = directory.find((item) => item.c === normalized.symbol);
        const quotePromise = fetchQuote(normalized.symbol, normalized.providerSymbol, directoryItem?.n, signal);
        const announcementPromise = directoryItem
          ? fetchAnnouncements(directoryItem, announcementLimit, signal)
          : Promise.reject(new Error(`${normalized.symbol} 未在港交所当前上市目录中找到`));
        const [quoteResult, announcementResult] = await Promise.allSettled([quotePromise, announcementPromise]);
        const errors: string[] = [];
        if (quoteResult.status === "rejected") errors.push(`行情：${errorMessage(quoteResult.reason)}`);
        if (announcementResult.status === "rejected") errors.push(`公告：${errorMessage(announcementResult.reason)}`);
        return {
          symbol: normalized.symbol,
          name: directoryItem?.n,
          quote: quoteResult.status === "fulfilled" ? quoteResult.value : undefined,
          announcements: announcementResult.status === "fulfilled" ? announcementResult.value : [],
          errors,
        };
      }));
      return {
        queriedAt,
        symbols,
        sourceNotes: [
          "公告来自港交所披露易官方搜索结果。",
          "行情来自腾讯行情公开快照，提供方未声明延迟分钟数，不能作为下单价格。",
          "适配器只读，不执行交易，也不自动生成买卖指令。",
        ],
      };
    },
  };
}
