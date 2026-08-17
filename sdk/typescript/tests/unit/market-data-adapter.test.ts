import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDefaultCapabilityToolRegistry } from "../../examples/companion/capability-tools.js";
import { createMarketDataAdapter, normalizeHongKongSymbol } from "../../examples/companion/market-data-adapter.js";
import { buildSourceVerificationReport } from "../../examples/companion/source-verification.js";

const NOW = new Date("2026-08-05T02:00:00.000Z");

function fakeMarketFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input);
  if (url.includes("activestock_sehk_e.json")) {
    return Promise.resolve(new Response(JSON.stringify([{ i: 7609, c: "00700", n: "TENCENT" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }
  if (url.includes("qt.gtimg.cn")) {
    const fields = Array.from({ length: 80 }, () => "");
    fields[0] = "100";
    fields[1] = "TENCENT";
    fields[2] = "00700";
    fields[3] = "550";
    fields[4] = "540";
    fields[5] = "545";
    fields[6] = "1234567";
    fields[30] = "2026/08/05 10:00:00";
    fields[31] = "10";
    fields[32] = "1.85";
    fields[33] = "552";
    fields[34] = "541";
    return Promise.resolve(new Response(`v_r_hk00700="${fields.join("~")}";`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }));
  }
  if (url.includes("titlesearch.xhtml")) {
    return Promise.resolve(new Response(`
      <table><tbody><tr>
        <td class="release-time"><span>Release Time: </span>05/08/2026 08:30</td>
        <td class="stock-short-code"><span>Stock Code: </span>00700</td>
        <td class="stock-short-name"><span>Stock Short Name: </span>TENCENT</td>
        <td><div class="headline">Announcements and Notices - [Inside Information]</div>
          <div class="doc-link"><a href="/listedco/listconews/sehk/2026/0805/fixture.pdf">Business update</a></div>
        </td>
      </tr></tbody></table>
    `, { status: 200, headers: { "Content-Type": "text/html" } }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

test("市场适配器持久保存关注列表并读取真实结构的公告和行情快照", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-market-adapter-"));
  try {
    const marketData = createMarketDataAdapter({
      dataDir: dir,
      fetchImpl: fakeMarketFetch as typeof fetch,
      now: () => NOW,
    });
    const items = await marketData.addWatchItem({ symbol: "0700.hk", name: "腾讯" });
    assert.deepEqual(items.map((item) => item.symbol), ["00700"]);
    assert.deepEqual(await marketData.listWatchlist(), items);

    const snapshot = await marketData.snapshot({ announcementLimit: 2 });
    assert.equal(snapshot.symbols.length, 1);
    assert.equal(snapshot.symbols[0].quote?.price, 550);
    assert.equal(snapshot.symbols[0].quote?.change, 10);
    assert.equal(snapshot.symbols[0].announcements[0].title, "Business update");
    assert.equal(snapshot.symbols[0].announcements[0].sourceQuality, "official-disclosure");
    assert.match(snapshot.symbols[0].announcements[0].url, /hkexnews\.hk/);
    assert.match(snapshot.sourceNotes.join("\n"), /不执行交易/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("市场资料工具只在市场任务中暴露并返回可核验结果", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-market-tool-"));
  try {
    const marketData = createMarketDataAdapter({ dataDir: dir, fetchImpl: fakeMarketFetch as typeof fetch, now: () => NOW });
    const registry = createDefaultCapabilityToolRegistry(dir, {
      hasLiveSearch: () => false,
      hasVision: () => false,
      hasVoice: () => false,
      marketData,
    });
    assert.equal(buildSourceVerificationReport("查询港股 00700 最新公告和行情").status, "live-adapter-ready");
    assert.equal(buildSourceVerificationReport("整理会议纪要，列出风险和待定负责人").relevant, false);
    assert.ok(registry.listAvailableForInstruction("查询港股 00700 最新公告和行情").some((tool) => tool.id === "source.market-briefing"));
    assert.ok(!registry.listAvailableForInstruction("整理会议纪要").some((tool) => tool.id === "source.market-briefing"));
    const result = await registry.run("source.market-briefing", { symbols: ["00700"] });
    assert.equal(result.ok, true);
    assert.equal(result.freshness?.availability, "available");
    assert.equal(result.freshness?.contentDigest?.length, 64);
    assert.match(result.text, /港交所公告/);
    assert.match(result.text, /第三方快照/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("港股代码规范化拒绝不明确的非数字标的", () => {
  assert.deepEqual(normalizeHongKongSymbol("9988.HK"), { symbol: "09988", providerSymbol: "9988.HK" });
  assert.throws(() => normalizeHongKongSymbol("TENCENT"), /不支持的港股代码/);
});
