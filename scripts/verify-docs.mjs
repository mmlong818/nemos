import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 与 .gitignore 对齐：本机工作目录与参考代码不属于本仓库的文档，不参与检查。
const ignoredDirectories = new Set([".git", "dist", "node_modules", "vendor", ".tmp", "tmp", "output", ".cache"]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function filesUnder(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}

const markdownFiles = filesUnder(root).filter((path) => extname(path).toLowerCase() === ".md");
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (!target || /^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    const localPath = decodeURIComponent(target.split("#")[0].split("?")[0]);
    if (localPath && !existsSync(resolve(dirname(file), localPath))) {
      fail(`失效链接：${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

const publicDocs = markdownFiles.map((file) => ({ file, content: readFileSync(file, "utf8") }));
for (const { file, content } of publicDocs) {
  if (/agent-v\d|Round\s+\d+\s*启动/i.test(content)) fail(`发现内部交接文字：${file.slice(root.length + 1)}`);
}

for (const file of markdownFiles.filter((path) => path.startsWith(join(root, "spec")) && !path.endsWith("README.md"))) {
  if (!readFileSync(file, "utf8").split(/\r?\n/).slice(0, 12).join("\n").includes("归档")) {
    fail(`归档规范缺少顶部状态：${file.slice(root.length + 1)}`);
  }
}
for (const file of markdownFiles.filter((path) => path.includes(`${join("docs", "reviews")}`) && /web-true-check/.test(path))) {
  if (!readFileSync(file, "utf8").split(/\r?\n/).slice(0, 8).join("\n").includes("历史评审记录")) {
    fail(`历史评审缺少顶部说明：${file.slice(root.length + 1)}`);
  }
}

const capabilityScript = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "web", "assets", "capability-center.js"), "utf8");
const publicCapabilityCount = [...capabilityScript.matchAll(/backendId:/g)].length;
const capabilityMap = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "docs", "clownfish-capability-map.md"), "utf8");
const companionReadme = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "README.md"), "utf8");
if (!capabilityMap.includes(`面向用户的 ${publicCapabilityCount} 项能力`)) fail("能力地图数量与界面不一致");
if (!companionReadme.includes(`当前能力页提供 ${publicCapabilityCount} 项能力`)) fail("应用 README 的能力数量与界面不一致");

const rootReadme = readFileSync(join(root, "README.md"), "utf8");
const englishReadme = readFileSync(join(root, "README.en.md"), "utf8");
const zhTests = rootReadme.match(/(\d+) 项自动化测试全部通过/)?.[1];
const enTests = englishReadme.match(/All (\d+) automated tests pass/)?.[1];
if (!zhTests || zhTests !== enTests) fail("中英文 README 的测试数量不一致");
/**
 * 每个界面当前应使用的截图，逐项登记。
 * 只有那个界面真的变了才重拍并改这里——用一个全局日期会逼着无关界面陪着重拍。
 */
const currentScreenshots = {
  chat: "docs/assets/readme/clownfish-chat-2026-08-10.png",
  capabilities: "docs/assets/readme/clownfish-capabilities-2026-08-10.png",
  office: "docs/assets/readme/clownfish-office-2026-08-11.png",
  work: "docs/assets/readme/clownfish-work-2026-08-10.png",
  memory: "docs/assets/readme/clownfish-memory-2026-08-10.png",
  "model-connection": "docs/assets/readme/clownfish-model-connection-2026-08-10.png",
};
for (const [screen, relativePath] of Object.entries(currentScreenshots)) {
  if (!existsSync(join(root, relativePath))) fail(`当前 README 截图不存在：${relativePath}`);
  if (!rootReadme.includes(relativePath) || !englishReadme.includes(relativePath)) {
    fail(`中英文 README 没有共同使用当前截图：${relativePath}`);
    continue;
  }
  // 同一界面不能同时残留旧版本的引用。
  const stale = new RegExp(`docs/assets/readme/clownfish-${screen}-\\d{4}-\\d{2}-\\d{2}(?:-v\\d+)?\\.(?:png|jpg)`, "g");
  for (const [label, content] of [["中文", rootReadme], ["英文", englishReadme]]) {
    const used = [...new Set(content.match(stale) ?? [])];
    if (used.length > 1) fail(`${label} README 同时引用了 ${screen} 的多张截图：${used.join("、")}`);
  }
}
if (/clownfish-[^)]+-2026-08-08\.jpg/.test(`${rootReadme}\n${englishReadme}`)) {
  fail("README 仍引用旧版 2026-08-08 截图");
}

const memoryDesign = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "docs", "capability-center-memory-design.md"), "utf8");
if (!memoryDesign.includes("不在普通记忆页展示")) fail("记忆文档没有说明原始归档在普通界面隐藏");
if (memoryDesign.includes("## 7. 当前尚未实现")) fail("当前记忆文档仍包含内部待办清单");

const manifest = JSON.parse(readFileSync(join(root, "bench", "results", "manifest.json"), "utf8"));
for (const result of manifest.results) {
  const path = join(root, "bench", "results", result.file);
  // 归一化换行后再哈希：直接哈希原始字节会把"哪台机器检出的"也算进去
  // （Windows 的 autocrlf 检出是 CRLF，Linux 是 LF），同一份数据得出两个值。
  // 冻结结果的哈希必须标识数据本身。
  const normalized = readFileSync(path, "utf8").split("\r\n").join("\n");
  const actual = createHash("sha256").update(normalized, "utf8").digest("hex");
  if (actual !== result.sha256) fail(`冻结结果哈希不一致：${result.file}`);
}

function metrics(file, collectionKey, nameKey) {
  const payload = JSON.parse(readFileSync(join(root, "bench", "results", file), "utf8"));
  const groups = new Map();
  for (const item of payload.per_item) {
    for (const variant of item[collectionKey]) {
      const judges = groups.get(variant[nameKey]) || [];
      judges.push(...variant.judged.map((entry) => entry.judge));
      groups.set(variant[nameKey], judges);
    }
  }
  return Object.fromEntries([...groups].map(([name, judges]) => [name, {
    expected: Number((judges.filter((item) => item.contains_expected).length / judges.length * 100).toFixed(1)),
    forbidden: Number((judges.filter((item) => item.contains_forbidden).length / judges.length * 100).toFixed(1)),
  }]));
}

const buc = metrics("buc.json", "variants", "variant");
const asp = metrics("asp.json", "modes", "mode");
const forgetting = metrics("for.json", "variants", "variant");
const expectedPaperMetrics = {
  bucFullLeak: buc["nemos-v2-semantic"].forbidden,
  bucNoneLeak: buc["nemos-no-invalidation"].forbidden,
  bucFullAccuracy: buc["nemos-v2-semantic"].expected,
  bucNoneAccuracy: buc["nemos-no-invalidation"].expected,
  aspIsolated: asp.isolate.forbidden,
  aspShared: asp.shared.forbidden,
  forgettingDecay: forgetting["nemos-v2-semantic"].forbidden,
  forgettingNone: forgetting["nemos-no-decay"].forbidden,
};
const englishPaper = readFileSync(join(root, "paper", "main.tex"), "utf8");
for (const value of Object.values(expectedPaperMetrics)) {
  if (!englishPaper.includes(String(value.toFixed(1)))) fail(`论文缺少冻结结果数字：${value.toFixed(1)}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`文档核验通过：${markdownFiles.length} 个 Markdown 文件、${manifest.results.length} 个冻结结果文件、${publicCapabilityCount} 项公开能力。`);
}
