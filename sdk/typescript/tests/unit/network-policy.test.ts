import assert from "node:assert/strict";
import test from "node:test";
import {
  NETWORK_POLICY_LIMITS,
  NetworkPolicyError,
  defaultNetworkPolicy,
  evaluateNetworkPolicy,
  networkPolicyRejection,
  normalizeNetworkPolicy,
  type NetworkPolicy,
} from "../../examples/companion/network-policy.js";

const policy = (over: Partial<NetworkPolicy> = {}): NetworkPolicy => ({ ...defaultNetworkPolicy(), ...over });

test("默认策略放行且两个名单为空，保持现有行为不变", () => {
  const value = defaultNetworkPolicy();
  assert.deepEqual(value, { version: 1, defaultAction: "allow", allow: [], deny: [] });
  assert.equal(evaluateNetworkPolicy(value, "example.com").allowed, true);
  assert.equal(evaluateNetworkPolicy(value, "example.com").matchedBy, "default");
  assert.deepEqual(normalizeNetworkPolicy(undefined), value);
  assert.deepEqual(normalizeNetworkPolicy(null), value);
});

// 名单类配置最常见的事故：一条宽泛的允许规则盖掉一条精确的拒绝规则。
test("拒绝优先于允许：通配允许不能盖掉精确拒绝", () => {
  const value = policy({ defaultAction: "deny", allow: ["*.example.com"], deny: ["internal.example.com"] });
  assert.equal(evaluateNetworkPolicy(value, "docs.example.com").allowed, true);
  const blocked = evaluateNetworkPolicy(value, "internal.example.com");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.matchedBy, "deny");
  assert.equal(blocked.matchedPattern, "internal.example.com");
  // 默认放行时，拒绝规则同样有效。
  assert.equal(evaluateNetworkPolicy(policy({ deny: ["ads.example.com"] }), "ads.example.com").allowed, false);
});

test("默认拒绝时只放行名单内主机", () => {
  const value = policy({ defaultAction: "deny", allow: ["example.com", "*.trusted.org"] });
  assert.equal(evaluateNetworkPolicy(value, "example.com").allowed, true);
  assert.equal(evaluateNetworkPolicy(value, "api.trusted.org").allowed, true);
  assert.equal(evaluateNetworkPolicy(value, "deep.api.trusted.org").allowed, true);
  const denied = evaluateNetworkPolicy(value, "elsewhere.com");
  assert.equal(denied.allowed, false);
  assert.equal(denied.matchedBy, "default");
  assert.equal(denied.matchedPattern, undefined);
});

// 想同时覆盖裸域就把两条都写上；通配顺带匹配裸域会让人在只想放开子域时放开主站。
test("*.example.com 匹配子域但不匹配裸域，也不匹配同后缀的其他域", () => {
  const value = policy({ defaultAction: "deny", allow: ["*.example.com"] });
  assert.equal(evaluateNetworkPolicy(value, "a.example.com").allowed, true);
  assert.equal(evaluateNetworkPolicy(value, "example.com").allowed, false);
  assert.equal(evaluateNetworkPolicy(value, "notexample.com").allowed, false);
  assert.equal(evaluateNetworkPolicy(value, "evil-example.com").allowed, false);
  assert.equal(evaluateNetworkPolicy(policy({ defaultAction: "deny", allow: ["example.com", "*.example.com"] }), "example.com").allowed, true);
});

// 直接用字面量构造策略的调用方绕过了 normalizeNetworkPolicy，判定时必须再归一化一次，
// 否则一条大小写不一致的拒绝规则会静默失效。
test("判定时对主机名和模式都归一化：大小写与末尾点不影响结果", () => {
  const value = policy({ deny: ["Blocked.Example.COM.", "*.Bad.ORG"] });
  assert.equal(evaluateNetworkPolicy(value, "BLOCKED.example.com").allowed, false);
  assert.equal(evaluateNetworkPolicy(value, "blocked.example.com.").allowed, false);
  assert.equal(evaluateNetworkPolicy(value, "a.bad.org").allowed, false);
  assert.equal(evaluateNetworkPolicy(value, "").allowed, true, "空主机名不命中任何规则，交给上游的地址判断");
  // IPv4 字面量可以作为模式；IPv6 不支持，见下一条。
  assert.equal(evaluateNetworkPolicy(policy({ deny: ["93.184.216.34"] }), "93.184.216.34").allowed, false);
});

test("IPv6 字面量不作为模式支持，且拒绝时说明原因", () => {
  assert.throws(() => normalizeNetworkPolicy({ deny: ["::1"] }), /IPv6 字面量/);
  assert.throws(() => normalizeNetworkPolicy({ deny: ["[::1]"] }), NetworkPolicyError);
});

test("不合法的模式一律报错，不静默丢弃", () => {
  for (const bad of ["https://example.com", "example.com:8080", "example.com/path", "user@example.com", "*", "ex*ample.com", "a.*.com", "", "   ", "不是主机名"]) {
    assert.throws(() => normalizeNetworkPolicy({ allow: [bad] }), NetworkPolicyError, `应当拒绝：${bad}`);
  }
  assert.throws(() => normalizeNetworkPolicy({ allow: [123] }), /只能包含文字/);
  assert.throws(() => normalizeNetworkPolicy({ allow: "example.com" }), /必须是数组/);
  assert.throws(() => normalizeNetworkPolicy({ defaultAction: "ask" }), /只能是 allow 或 deny/);
  assert.throws(() => normalizeNetworkPolicy({ version: 2 }), /版本不受支持/);
  assert.throws(() => normalizeNetworkPolicy("not-an-object"), /格式不正确/);
  assert.throws(() => normalizeNetworkPolicy({ allow: ["a".repeat(300) + ".com"] }), /过长/);
  assert.throws(
    () => normalizeNetworkPolicy({ deny: Array.from({ length: NETWORK_POLICY_LIMITS.maxEntries + 1 }, (_, i) => `h${i}.com`) }),
    /最多/,
  );
});

test("归一化保留有效条目、去重并小写化", () => {
  const value = normalizeNetworkPolicy({
    defaultAction: "deny",
    allow: ["Example.COM", "example.com", "example.com.", "*.Trusted.org", "with_underscore.test"],
    deny: ["bad.example.com"],
  });
  assert.deepEqual(value.allow, ["example.com", "*.trusted.org", "with_underscore.test"]);
  assert.deepEqual(value.deny, ["bad.example.com"]);
  assert.equal(value.version, 1);
});

test("拒绝理由说清是哪条规则拦的，用户才能自己修好", () => {
  const denied = networkPolicyRejection("internal.example.com", { allowed: false, matchedBy: "deny", matchedPattern: "*.example.com" });
  assert.match(denied, /internal\.example\.com/);
  assert.match(denied, /\*\.example\.com/);
  assert.match(networkPolicyRejection("elsewhere.com", { allowed: false, matchedBy: "default" }), /默认拒绝/);
});

// 策略必须在 DNS 解析之前生效：被拒绝的域名若仍被解析一次，就等于向那台 DNS
// 泄露了访问意图。用一个不可解析的域名验证——若先解析就会得到解析错误。
test("出站读取在解析域名之前应用策略", async () => {
  const { readPublicWebUrl, assertPublicWebUrl } = await import("../../examples/companion/local-http-security.js");
  const denyAll = normalizeNetworkPolicy({ defaultAction: "deny" });

  await assert.rejects(
    () => readPublicWebUrl({ url: "https://nonexistent.invalid/x", maxBytes: 1000, policy: denyAll }),
    /网络策略拒绝访问/,
  );
  await assert.rejects(() => assertPublicWebUrl("https://nonexistent.invalid/x", denyAll), /网络策略拒绝访问/);

  // 不传策略时行为不变：仍然只有私网拦截，域名照旧解析（这里预期解析失败）。
  await assert.rejects(
    () => readPublicWebUrl({ url: "https://nonexistent.invalid/x", maxBytes: 1000 }),
    (error: unknown) => !/网络策略/.test(String(error)),
  );
  // 私网拦截与策略无关，即使策略明确允许该主机也仍然拦下。
  await assert.rejects(
    () => assertPublicWebUrl("http://127.0.0.1:9/x", normalizeNetworkPolicy({ allow: ["127.0.0.1"] })),
    /local web address|private network/,
  );
});
