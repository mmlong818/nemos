/**
 * 出站网络策略：按主机的允许／拒绝名单。
 *
 * 现有的两道防护各管一段，中间空着：
 * - `local-http-security.ts` 按地址拦截本机与私网（DNS 钉住后再判），管的是"不许打到内网"；
 * - Agent 扩展的 `runtime.sandbox.network` 只有 `deny | unrestricted` 两档，管的是
 *   "这个子进程能不能上网"。
 *
 * 都没有回答"允许上网，但只许访问这几个域名"。本策略补的就是这一段，作用于**应用
 * 自身的出站读取**。
 *
 * ## 它管不到什么（必须说清，否则会被当成比实际更强的保证）
 *
 * 被 spawn 出去的 MCP 子进程不受这里约束：Node 的 `--allow-net` 是全有全无，
 * AppContainer 也不做按主机过滤。子进程的网络边界仍然只有那两档。所以一条
 * `defaultAction: "deny"` 的策略不等于"整个应用只能访问名单内域名"，只等于
 * "应用自己发起的网页读取只能访问名单内域名"。
 *
 * ## 优先级：deny > allow > defaultAction
 *
 * 参考实现只写了「default_action + deny[] + allow[]」而没说谁先谁后。这里明确
 * 拒绝优先：允许 `*.example.com` 同时拒绝 `internal.example.com` 时，内网那台必须
 * 被挡住。反过来（允许优先）会让一条宽泛的允许规则把精确的拒绝规则盖掉，
 * 这是名单类配置最常见的事故。
 */

export type NetworkDefaultAction = "allow" | "deny";

export interface NetworkPolicy {
  version: 1;
  defaultAction: NetworkDefaultAction;
  /** 主机模式：精确域名，或 `*.example.com` 形式的子域通配。 */
  allow: string[];
  deny: string[];
}

export class NetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkPolicyError";
  }
}

export const NETWORK_POLICY_LIMITS = {
  maxEntries: 200,
  maxHostLength: 253,
} as const;

/**
 * 默认策略：放行，两个名单都空。
 *
 * 默认拒绝听起来更安全，但它会让所有现有的网页读取在用户没配任何名单时立刻失效，
 * 而失效原因对用户表现为"网页读不出来"。默认放行 + 私网拦截保持现状，
 * 想要白名单的用户显式切到 deny。
 */
export function defaultNetworkPolicy(): NetworkPolicy {
  return { version: 1, defaultAction: "allow", allow: [], deny: [] };
}

export interface NetworkPolicyVerdict {
  allowed: boolean;
  /** 命中的规则来源，用于向用户解释"凭什么"。 */
  matchedBy: "deny" | "allow" | "default";
  matchedPattern?: string;
}

/**
 * 判定一个主机名。
 *
 * hostname 必须是已经归一化过的主机名（`new URL(...).hostname`），不含端口、
 * 不含方括号。这里不做地址判断——私网与本机由 local-http-security 负责，
 * 两处职责分开，避免同一个判断有两份实现。
 */
export function evaluateNetworkPolicy(policy: NetworkPolicy, hostname: string): NetworkPolicyVerdict {
  const host = normalizeHost(hostname);
  const denied = policy.deny.find((pattern) => hostMatches(host, pattern));
  if (denied) return { allowed: false, matchedBy: "deny", matchedPattern: denied };
  const allowed = policy.allow.find((pattern) => hostMatches(host, pattern));
  if (allowed) return { allowed: true, matchedBy: "allow", matchedPattern: allowed };
  return { allowed: policy.defaultAction === "allow", matchedBy: "default" };
}

/** 判定失败时给用户看的一句话。说清是哪条规则拦的，否则用户无法自行修好。 */
export function networkPolicyRejection(hostname: string, verdict: NetworkPolicyVerdict): string {
  return verdict.matchedBy === "deny"
    ? `网络策略拒绝访问 ${hostname}：命中拒绝规则 ${verdict.matchedPattern}`
    : `网络策略拒绝访问 ${hostname}：默认拒绝，且不在允许名单内`;
}

/**
 * 归一化并校验一份策略。
 *
 * 不接受的模式一律报错而不是静默丢弃：一条被悄悄忽略的拒绝规则，
 * 会让用户以为某个域名已经被挡住了。
 */
export function normalizeNetworkPolicy(value: unknown): NetworkPolicy {
  if (value === undefined || value === null) return defaultNetworkPolicy();
  if (typeof value !== "object" || Array.isArray(value)) throw new NetworkPolicyError("网络策略格式不正确");
  const raw = value as Partial<NetworkPolicy>;
  if (raw.version !== undefined && raw.version !== 1) throw new NetworkPolicyError("网络策略版本不受支持");
  const defaultAction = raw.defaultAction ?? "allow";
  if (defaultAction !== "allow" && defaultAction !== "deny") {
    throw new NetworkPolicyError("网络策略的默认动作只能是 allow 或 deny");
  }
  return {
    version: 1,
    defaultAction,
    allow: normalizeList(raw.allow, "允许名单"),
    deny: normalizeList(raw.deny, "拒绝名单"),
  };
}

function normalizeList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new NetworkPolicyError(`${label}必须是数组`);
  if (value.length > NETWORK_POLICY_LIMITS.maxEntries) {
    throw new NetworkPolicyError(`${label}最多 ${NETWORK_POLICY_LIMITS.maxEntries} 条`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const pattern = normalizePattern(item, label);
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    result.push(pattern);
  }
  return result;
}

/**
 * 只接受主机模式，不接受协议、端口和路径。
 *
 * 允许写路径会给出错误的安全感：重定向、查询串和大小写变化都能绕过路径匹配，
 * 而用户会以为自己限制到了某个目录。要按路径控制应当在业务层做，不是在这里。
 */
function normalizePattern(value: unknown, label: string): string {
  if (typeof value !== "string") throw new NetworkPolicyError(`${label}只能包含文字`);
  const pattern = value.trim().toLowerCase().replace(/\.$/, "");
  if (!pattern) throw new NetworkPolicyError(`${label}不能包含空项`);
  if (pattern.length > NETWORK_POLICY_LIMITS.maxHostLength) {
    throw new NetworkPolicyError(`${label}的条目过长：${pattern.slice(0, 40)}…`);
  }
  if (/[:/\\?#@]/.test(pattern)) {
    // 冒号同时挡掉端口和 IPv6 字面量。IPv6 不作为模式支持：压缩写法与 ::ffff: 映射
    // 有多种等价形式，做半套匹配比不做更危险；本机与私网地址已由 local-http-security
    // 的地址级判断覆盖。IPv4 字面量能正常书写（数字与点符合主机名规则）。
    throw new NetworkPolicyError(`${label}只能写主机名，不能包含协议、端口、路径或 IPv6 字面量：${pattern}`);
  }
  const body = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  if (pattern === "*" || body.includes("*")) {
    throw new NetworkPolicyError(`${label}的通配只支持 *.example.com 形式：${pattern}`);
  }
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(body)) {
    throw new NetworkPolicyError(`${label}不是有效的主机名：${pattern}`);
  }
  return pattern;
}

function normalizeHost(hostname: string): string {
  return String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * `*.example.com` 匹配子域但**不**匹配 `example.com` 本身。
 *
 * 这是名单类配置里最少意外的语义：想同时覆盖裸域就把两条都写上。反过来
 * （通配顺带匹配裸域）会让人在只想放开子域时意外放开主站。
 */
function hostMatches(host: string, rawPattern: string): boolean {
  if (!host) return false;
  // 模式也在这里归一化一次。normalizeNetworkPolicy 已经做过，但直接用字面量构造
  // 策略对象的调用方（测试、脚本、将来的默认配置）绕过了它；少了这一步，一条
  // 大小写不一致的拒绝规则会静默失效，而失效是看不见的。
  const pattern = normalizeHost(rawPattern);
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}
