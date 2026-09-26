import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AppUpdateChecker, compareVersions, parseLatestRelease, RELEASES_API, RELEASES_PAGE, UPDATE_CHECK_INTERVAL_MS,
} from "../../examples/companion/app-update.js";

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { impl, calls };
}

const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `${RELEASES_PAGE}/tag/${tag}`, name: `小丑鱼 ${tag}`, published_at: "2026-09-27T00:00:00Z", ...extra });
const tempFile = () => join(mkdtempSync(join(tmpdir(), "app-update-")), "update-check.json");

test("用户没回答之前一个请求都不发", async () => {
  const { impl, calls } = fakeFetch([]);
  const checker = new AppUpdateChecker(tempFile(), "0.7.6", impl);
  const status = await checker.refreshIfDue();
  assert.equal(status.enabled, null);
  assert.equal(status.available, false);
  assert.equal(calls.length, 0);
});

test("同意后立刻检查一次，有新版本时标记可更新；请求不带任何本机信息", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: release("v0.7.7") }]);
  const checker = new AppUpdateChecker(tempFile(), "0.7.6", impl);
  const status = await checker.setEnabled(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RELEASES_API);
  assert.equal(calls[0].init?.body, undefined);
  assert.deepEqual(Object.keys(calls[0].init?.headers as Record<string, string>).sort(), ["accept", "user-agent"]);
  assert.doesNotMatch(JSON.stringify(calls[0].init?.headers), /0\.7\.6/, "不上报当前版本");
  assert.equal(status.available, true);
  assert.equal(status.latest?.version, "0.7.7");
  assert.equal(status.latest?.url, `${RELEASES_PAGE}/tag/v0.7.7`);
});

test("间隔内不重复联网，过了间隔才再查", async () => {
  let now = Date.parse("2026-09-27T00:00:00Z");
  const { impl, calls } = fakeFetch([{ status: 200, body: release("v0.7.6") }, { status: 200, body: release("v0.7.8") }]);
  const checker = new AppUpdateChecker(tempFile(), "0.7.6", impl, () => now);
  assert.equal((await checker.setEnabled(true)).available, false, "同版本不提示");
  now += UPDATE_CHECK_INTERVAL_MS - 1000;
  await checker.refreshIfDue();
  assert.equal(calls.length, 1);
  now += 2000;
  const status = await checker.refreshIfDue();
  assert.equal(calls.length, 2);
  assert.equal(status.latest?.version, "0.7.8");
});

test("还没有发布（404）不算错误；网络失败只记下原因，不抛出", async () => {
  const { impl } = fakeFetch([{ status: 404 }, new TypeError("fetch failed")]);
  let now = Date.parse("2026-09-27T00:00:00Z");
  const checker = new AppUpdateChecker(tempFile(), "0.7.6", impl, () => now);
  const first = await checker.setEnabled(true);
  assert.equal(first.available, false);
  assert.equal(first.lastError, undefined);
  now += UPDATE_CHECK_INTERVAL_MS + 1;
  const second = await checker.refreshIfDue();
  assert.equal(second.available, false);
  assert.equal(second.lastError, "暂时连不上 GitHub");
});

test("关闭后清掉已缓存的版本信息，也不再联网；状态跨重启保留", async () => {
  const file = tempFile();
  const { impl, calls } = fakeFetch([{ status: 200, body: release("v0.8.0") }]);
  const checker = new AppUpdateChecker(file, "0.7.6", impl);
  await checker.setEnabled(true);
  const off = await checker.setEnabled(false);
  assert.equal(off.enabled, false);
  assert.equal(off.available, false);
  assert.equal(off.latest, undefined);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false });
  const reopened = new AppUpdateChecker(file, "0.7.6", impl);
  assert.equal((await reopened.refreshIfDue()).enabled, false);
  assert.equal(calls.length, 1);
});

test("版本比较与发布解析", () => {
  assert.equal(compareVersions("0.7.10", "0.7.9"), 1);
  assert.equal(compareVersions("v0.8", "0.7.99"), 1);
  assert.equal(compareVersions("0.7.6", "v0.7.6"), 0);
  assert.equal(compareVersions("0.7.7-beta.1", "0.7.7"), -1);
  assert.equal(parseLatestRelease(release("v0.7.7", { prerelease: true })), null);
  assert.equal(parseLatestRelease(release("v0.7.7", { draft: true })), null);
  assert.equal(parseLatestRelease({ tag_name: "nightly" }), null);
  assert.equal(parseLatestRelease(release("v0.7.7", { html_url: "https://example.com/evil" }))?.url, RELEASES_PAGE, "只信本仓库的发布页链接");
});
