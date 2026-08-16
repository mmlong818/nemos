import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const installedRoot = join(packageRoot, "node_modules");
const allowedMissingMetadata = new Set([
  "opencode-windows-x64@1.18.18",
  "opencode-windows-x64-baseline@1.18.18",
  "png-js@1.1.0",
]);
const forbiddenLicensePattern = /AGPL|SSPL|BUSL|Commons Clause|CC-BY-NC/i;
const packages = new Map();

function scanPackage(packagePath) {
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const identity = `${manifest.name ?? packagePath}@${manifest.version ?? "unknown"}`;
  const license = typeof manifest.license === "string"
    ? manifest.license
    : manifest.licenses
      ? JSON.stringify(manifest.licenses)
      : "UNKNOWN";
  packages.set(identity, license);
  scanNodeModules(join(packagePath, "node_modules"));
}

function scanNodeModules(nodeModulesPath) {
  if (!existsSync(nodeModulesPath)) return;
  for (const entry of readdirSync(nodeModulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const entryPath = join(nodeModulesPath, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) scanPackage(join(entryPath, scopedEntry.name));
      }
    } else {
      scanPackage(entryPath);
    }
  }
}

scanNodeModules(installedRoot);

const failures = [];
const counts = new Map();
for (const [identity, license] of packages) {
  counts.set(license, (counts.get(license) ?? 0) + 1);
  if (forbiddenLicensePattern.test(license)) failures.push(`${identity}: ${license}`);
  if (license === "UNKNOWN" && !allowedMissingMetadata.has(identity)) {
    failures.push(`${identity}: 缺少许可证元数据且未经过人工核对`);
  }
}

console.log(`许可证检查：${packages.size} 个唯一包版本`);
for (const [license, count] of [...counts].sort((left, right) => right[1] - left[1])) {
  console.log(`- ${license}: ${count}`);
}

if (failures.length > 0) {
  console.error("许可证检查失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
