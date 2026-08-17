import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createMcpProviderFromManifest, validateAgentExtensionManifest } from "../../src/index.js";
import {
  bundledCapabilityPluginCatalog,
  createBundledCapabilityProvider,
} from "../../examples/companion/bundled-capability-plugins.js";
import { platformConnectorStatuses } from "../../examples/companion/product-platform.js";

const packageRoot = resolve(__dirname, "../..");

test("内置能力目录提供浏览器、数据、邮件日历和媒体四类可安装插件", () => {
  const catalog = bundledCapabilityPluginCatalog({ packageRoot });
  assert.deepEqual(catalog.map((item) => item.id), [
    "browser.playwright",
    "analysis.safe-table",
    "productivity.communication-files",
    "media.generate",
  ]);
  assert.equal(catalog.every((item) => validateAgentExtensionManifest(item.manifest).length === 0), true);
  assert.equal(catalog.every((item) => item.dependencySummary.length > 0), true);
  assert.equal(catalog.find((item) => item.id === "browser.playwright")?.installable, true);
  assert.match(catalog.find((item) => item.id === "analysis.safe-table")!.dependencySummary, /不需要外部服务/);
  assert.match(catalog.find((item) => item.id === "media.generate")!.dependencySummary, /API/);
});

test("官方 Playwright MCP 可以真实启动并发现受控浏览器工具", { timeout: 30_000 }, async () => {
  const item = bundledCapabilityPluginCatalog({ packageRoot }).find((candidate) => candidate.id === "browser.playwright")!;
  const provider = createMcpProviderFromManifest(item.manifest)!;
  try {
    const tools = await provider.discover("browser playwright", AbortSignal.timeout(20_000));
    assert.equal(tools.some((tool) => tool.name === "browser_navigate"), true);
    assert.equal(tools.some((tool) => tool.name === "browser_take_screenshot"), true);
  } finally {
    await provider.close?.();
  }
});

test("媒体插件通过本机模拟端点生成图像并完成视频生命周期", { timeout: 10_000 }, async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === "/v1/images/generations") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] }));
      return;
    }
    if (request.url === "/v1/videos" && request.method === "POST") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "video_test_1", status: "queued" }));
      return;
    }
    if (request.url === "/v1/videos/video_test_1") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "video_test_1", status: "completed", progress: 100 }));
      return;
    }
    if (request.url === "/v1/videos/video_test_1/content") {
      response.setHeader("content-type", "video/mp4");
      response.end(Buffer.from("video-bytes"));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const previousBase = process.env.NEMOS_MEDIA_API_BASE;
  const previousKey = process.env.NEMOS_MEDIA_API_KEY;
  process.env.NEMOS_MEDIA_API_BASE = `http://127.0.0.1:${(address as { port: number }).port}/v1`;
  process.env.NEMOS_MEDIA_API_KEY = "test-only-key";
  const dataDir = mkdtempSync(resolve(tmpdir(), "nemos-media-plugin-"));
  try {
    const item = bundledCapabilityPluginCatalog({ packageRoot }).find((candidate) => candidate.id === "media.generate")!;
    const provider = createBundledCapabilityProvider(item.manifest, dataDir)!;
    const context = { runId: "run", sessionId: "session", signal: AbortSignal.timeout(5_000) };
    const image = await (await provider.loadTool("generate_image", context.signal)).execute({ prompt: "一条小丑鱼" }, context);
    const imageFile = (image.data as { file: string }).file;
    assert.equal(existsSync(imageFile), true);
    assert.equal(readFileSync(imageFile, "utf8"), "image-bytes");
    const created = await (await provider.loadTool("create_video", context.signal)).execute({ prompt: "游动" }, context);
    assert.match(created.content, /video_test_1/);
    const checked = await (await provider.loadTool("check_video", context.signal)).execute({ id: "video_test_1" }, context);
    assert.match(checked.content, /completed/);
    const downloaded = await (await provider.loadTool("download_video", context.signal)).execute({ id: "video_test_1" }, context);
    const videoFile = (downloaded.data as { file: string }).file;
    assert.equal(readFileSync(videoFile, "utf8"), "video-bytes");
    assert.deepEqual(requests, [
      "POST /v1/images/generations",
      "POST /v1/videos",
      "GET /v1/videos/video_test_1",
      "GET /v1/videos/video_test_1/content",
    ]);
  } finally {
    if (previousBase === undefined) delete process.env.NEMOS_MEDIA_API_BASE;
    else process.env.NEMOS_MEDIA_API_BASE = previousBase;
    if (previousKey === undefined) delete process.env.NEMOS_MEDIA_API_KEY;
    else process.env.NEMOS_MEDIA_API_KEY = previousKey;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("安全数据分析插件不执行代码并输出结构统计", async () => {
  const item = bundledCapabilityPluginCatalog({ packageRoot }).find((candidate) => candidate.id === "analysis.safe-table")!;
  const provider = createBundledCapabilityProvider(item.manifest, mkdtempSync(resolve(tmpdir(), "nemos-plugin-")))!;
  const tools = await provider.discover("请分析CSV的缺失值", AbortSignal.timeout(2_000));
  assert.equal(tools.some((tool) => tool.name === "analyze_table"), true);
  const tool = await provider.loadTool("analyze_table", AbortSignal.timeout(2_000));
  const result = await tool.execute({ content: "name,score\n甲,10\n乙,20\n丙," }, { runId: "run", sessionId: "session", signal: AbortSignal.timeout(2_000) });
  assert.match(result.content, /共 3 行，2 列/);
  assert.match(result.content, /score：数值；缺失 1/);
});

test("邮件日历插件可解析 EML 和检查 ICS 冲突", async () => {
  const item = bundledCapabilityPluginCatalog({ packageRoot }).find((candidate) => candidate.id === "productivity.communication-files")!;
  const provider = createBundledCapabilityProvider(item.manifest, mkdtempSync(resolve(tmpdir(), "nemos-plugin-")))!;
  const email = await provider.loadTool("parse_eml_file", AbortSignal.timeout(2_000));
  const emailResult = await email.execute({ content: "From: a@example.com\nTo: b@example.com\nSubject: 项目进度\n\n今天完成联调。" }, { runId: "run", sessionId: "session", signal: AbortSignal.timeout(2_000) });
  assert.match(emailResult.content, /主题：项目进度/);
  const calendar = await provider.loadTool("parse_ics_file", AbortSignal.timeout(2_000));
  const calendarResult = await calendar.execute({ content: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:A\nDTSTART:20260817T090000\nDTEND:20260817T100000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:B\nDTSTART:20260817T093000\nDTEND:20260817T103000\nEND:VEVENT\nEND:VCALENDAR" }, { runId: "run", sessionId: "session", signal: AbortSignal.timeout(2_000) });
  assert.match(calendarResult.content, /发现可能冲突：A ↔ B/);
  const connectors = platformConnectorStatuses([{ enabled: true, manifest: item.manifest }]);
  assert.equal(connectors.find((connector) => connector.id === "email")?.state, "not-installed");
  assert.equal(connectors.find((connector) => connector.id === "calendar")?.state, "not-installed");
});
