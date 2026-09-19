import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 与 .gitignore 对齐：本机工作目录与参考代码不属于本仓库的文档，不参与检查。
const ignoredDirectories = new Set([".git", "dist", "node_modules", "vendor", ".tmp", "tmp", "output", "outputs", ".cache"]);
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
    if (!localPath) continue;
    const resolved = resolve(dirname(file), localPath);
    // 越出仓库根的链接一律失败，即使那个文件在作者机器上真的存在。
    // 这类链接在本机静默通过、只在 CI 上失效——`../../outputs/…` 就这么骗过检查很久，
    // 直到文档核验第一次真正在 CI 上跑起来。存在性检查必须先确认目标在仓库里。
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      fail(`链接越出仓库根：${file.slice(root.length + 1)} -> ${target}`);
    } else if (!existsSync(resolved)) {
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

// 目录已从 capability-center.js 搬到 workflow-catalog.js（能力页和 Bot 页共用同一份）。
// 这里跟着搬：核验必须读界面真正使用的那份，读旧文件会一直数出 0 项。
const capabilityScript = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "web", "assets", "workflow-catalog.js"), "utf8");
const publicCapabilityCount = [...capabilityScript.matchAll(/backendId:/g)].length;
if (publicCapabilityCount === 0) fail("没有从工作流目录读到任何能力，核验读的可能已不是界面使用的目录");
const capabilityMap = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "docs", "clownfish-capability-map.md"), "utf8");
const companionReadme = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "README.md"), "utf8");
if (!capabilityMap.includes(`面向用户的 ${publicCapabilityCount} 项能力`)) fail("能力地图数量与界面不一致");
if (!companionReadme.includes(`当前能力页提供 ${publicCapabilityCount} 项能力`)) fail("应用 README 的能力数量与界面不一致");

const rootReadme = readFileSync(join(root, "README.md"), "utf8");
const englishReadme = readFileSync(join(root, "README.en.md"), "utf8");
// 措辞跟着 README 走：这两条正则只负责"中英说的是同一个数"，不负责句子怎么写。
// 改 README 里这句话时必须同步改这里——否则匹配不到，zhTests 变 undefined，守卫会直接报错
// （这是好的失效方向：宁可报错，也不要静默跳过校验）。
const zhTests = rootReadme.match(/(\d+) 项自动化测试无失败/)?.[1];
const enTests = englishReadme.match(/(\d+) automated tests with no failures/)?.[1];
if (!zhTests || zhTests !== enTests) fail("中英文 README 的测试数量不一致");
// 2026-09-20 审计确认这些截图早于双 Key 设置与万神殿界面，且包含已淘汰的
// 内部型号名称。文件暂留作历史资产，但公开 README 不得继续引用；取得真实当前
// 页面截图后，应在这里用明确的已核验登记表替换这份禁用清单。
const outdatedScreenshots = [
  "docs/assets/readme/clownfish-overview-current.png",
  "docs/assets/readme/clownfish-assistant-current.png",
  "docs/assets/readme/clownfish-task-current.png",
  "docs/assets/readme/clownfish-memory-current.png",
  "docs/assets/readme/clownfish-models-current.png",
];
for (const [label, content] of [["中文", rootReadme], ["英文", englishReadme]]) {
  for (const relativePath of outdatedScreenshots) {
    if (content.includes(relativePath)) fail(`${label} README 引用了已确认过时的截图：${relativePath}`);
  }
  for (const reference of new Set(content.match(/docs\/assets\/readme\/[\w.-]+/g) ?? [])) {
    fail(`${label} README 引用了尚未登记为当前页面的截图：${reference}`);
  }
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
