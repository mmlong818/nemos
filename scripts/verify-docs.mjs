import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 与 .gitignore 对齐：本机工作目录与参考代码不属于本仓库的文档，不参与检查。
const ignoredDirectories = new Set([".git", ".agent-browser", ".local-workbench", "dist", "node_modules", "vendor", ".tmp", "tmp", "output", "outputs", ".cache"]);
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

// 核验直接读取能力页和 Bot 页共用的当前工作流目录。
const capabilityScript = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "web", "assets", "workflow-catalog.js"), "utf8");
const publicCapabilityCount = [...capabilityScript.matchAll(/backendId:/g)].length;
if (publicCapabilityCount === 0) fail("没有从工作流目录读到任何能力，核验读的可能已不是界面使用的目录");
const capabilityMap = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "docs", "clownfish-capability-map.md"), "utf8");
const companionReadme = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "README.md"), "utf8");
if (!capabilityMap.includes(`面向用户的 ${publicCapabilityCount} 项能力`)) fail("能力地图数量与界面不一致");
if (!companionReadme.includes(`当前能力页提供 ${publicCapabilityCount} 项能力`)) fail("应用 README 的能力数量与界面不一致");

const rootReadme = readFileSync(join(root, "README.md"), "utf8");
const englishReadme = readFileSync(join(root, "README.en.md"), "utf8");
const currentScreenshots = [
  "docs/assets/readme/overview.png",
  "docs/assets/readme/task-workspace.png",
  "docs/assets/readme/pantheon.png",
  "docs/assets/readme/memory.png",
  "docs/assets/readme/model-setup.png",
];
for (const [label, content] of [["中文", rootReadme], ["英文", englishReadme]]) {
  for (const relativePath of currentScreenshots) {
    if (!content.includes(relativePath)) fail(`${label} README 缺少当前产品截图：${relativePath}`);
  }
  for (const reference of new Set(content.match(/docs\/assets\/readme\/[\w.-]+/g) ?? [])) {
    if (!currentScreenshots.includes(reference)) fail(`${label} README 引用了尚未登记为当前页面的截图：${reference}`);
  }
}

const memoryDesign = readFileSync(join(root, "sdk", "typescript", "examples", "companion", "docs", "capability-center-memory-design.md"), "utf8");
if (!memoryDesign.includes("不在普通记忆页展示")) fail("记忆文档没有说明原始归档在普通界面隐藏");
if (memoryDesign.includes("## 7. 当前尚未实现")) fail("当前记忆文档仍包含内部待办清单");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`文档核验通过：${markdownFiles.length} 个 Markdown 文件、${currentScreenshots.length} 张当前产品图、${publicCapabilityCount} 项公开能力。`);
}
