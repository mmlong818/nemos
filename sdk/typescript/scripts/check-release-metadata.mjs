import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");

const readText = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(readText(path));
const packageJson = readJson(resolve(packageRoot, "package.json"));
const packageLock = readJson(resolve(packageRoot, "package-lock.json"));
const manifest = readJson(resolve(packageRoot, "examples", "companion", "client", "manifest.json"));
const version = String(packageJson.version || "");

const failures = [];
const expectEqual = (label, actual) => {
  if (String(actual || "") !== version) failures.push(`${label}=${String(actual || "<empty>")}，应为 ${version}`);
};
const expectContains = (label, file, needle) => {
  if (!readText(file).includes(needle)) failures.push(`${label} 缺少 ${JSON.stringify(needle)}`);
};

if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`package.json 版本不是稳定 SemVer：${version}`);
expectEqual("package-lock.json", packageLock.version);
expectEqual("package-lock packages['']", packageLock.packages?.[""]?.version);
expectEqual("桌面清单", manifest.version);

expectContains("服务端回退清单", resolve(packageRoot, "examples", "companion", "server.ts"), `version: "${version}"`);
expectContains("中文 README 徽章", resolve(repoRoot, "README.md"), `版本-v${version}`);
expectContains("英文 README 徽章", resolve(repoRoot, "README.en.md"), `version-v${version}`);
// README 按开源项目形式重构后，概览小节改名为「这是什么 / What it is」。这里认新旧两种：
// 这条守卫真正要保证的是"README 描述的是当前发布版本"，而版本一致由上面的徽章检查负责；
// 标题名只是用来确认概览小节还在，不该把它钉死在某一次文案上。
const overviewHeadings = {
  "README.md": [`## v${version} 正式版`, "## 产品概览", "## 这是什么"],
  "README.en.md": [`## v${version} release`, "## Product overview", "## What it is"],
};
for (const [file, headings] of Object.entries(overviewHeadings)) {
  const content = readText(resolve(repoRoot, file));
  if (!headings.some((heading) => content.includes(heading))) {
    failures.push(`${file} 缺少概览小节标题（可用：${headings.join(" / ")}）`);
  }
}
expectContains("本机应用文档", resolve(packageRoot, "examples", "companion", "README.md"), `统一发布版本：**${version}**`);
expectContains("中文隐私协议", resolve(repoRoot, "PRIVACY.md"), `版本：${version}`);
expectContains("英文隐私协议", resolve(repoRoot, "PRIVACY.en.md"), `Version: ${version}`);
expectContains("设置中心隐私入口", resolve(packageRoot, "examples", "companion", "web", "assets", "settings-center.js"), "state.manifest?.version");
expectContains("便携包中文隐私协议", resolve(packageRoot, "examples", "companion", "client", "Build-Clownfish.ps1"), '"PRIVACY.md"');
expectContains("便携包英文隐私协议", resolve(packageRoot, "examples", "companion", "client", "Build-Clownfish.ps1"), '"PRIVACY.en.md"');

if (failures.length) {
  console.error(`发布元数据检查失败：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`发布元数据一致：v${version}；中英文隐私协议已进入设置入口和便携包。`);
