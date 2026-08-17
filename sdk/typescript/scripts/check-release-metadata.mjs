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
expectContains("中文 README 标题", resolve(repoRoot, "README.md"), `## v${version} 正式版`);
expectContains("英文 README 徽章", resolve(repoRoot, "README.en.md"), `version-v${version}`);
expectContains("英文 README 标题", resolve(repoRoot, "README.en.md"), `## v${version} release`);
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
