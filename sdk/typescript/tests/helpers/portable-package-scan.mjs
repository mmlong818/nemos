import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve as resolvePath } from "node:path";

const portableArgument = process.argv[2];
if (!portableArgument) throw new Error("usage: portable-package-scan.mjs <portable-root>");
const portableRoot = resolvePath(portableArgument);
const appRoot = join(portableRoot, "app");
const releaseRoot = resolvePath(portableRoot, "..", "..");
const manifest = JSON.parse(readFileSync(join(portableRoot, "manifest.json"), "utf8"));
const archiveName = `小丑鱼-${manifest.version}-windows-x64-portable.zip`;
const archivePath = join(releaseRoot, archiveName);
const expectedHash = readFileSync(`${archivePath}.sha256.txt`, "utf8").trim().split(/\s+/)[0];
const actualHash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");

const files = [];
const pending = [portableRoot];
while (pending.length) {
  const directory = pending.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) pending.push(path);
    else if (entry.isFile()) files.push(path);
  }
}

const forbiddenExtensions = new Set([".ts", ".tsx", ".map", ".cmd", ".ps1"]);
const runtimeSources = files.filter((path) => path.startsWith(appRoot)
  && !path.includes(`${join("app", "node_modules")}\\`)
  && forbiddenExtensions.has(extname(path).toLowerCase()));
const privateStateNames = files.filter((path) => /^(\.env(?:\..*)?|.*\.(?:db|sqlite)(?:-wal|-shm)?|settings\.json|relationships\.json|credentials?\.(?:json|txt))$/i.test(basename(path)));
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".nuspec", ".txt", ".xml", ".cmd"]);
const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}|AKIA[0-9A-Z]{16}|\bsk-[A-Za-z0-9_-]{16,}\b/;
const secretContentHits = files.filter((path) => {
  if (!textExtensions.has(extname(path).toLowerCase()) || statSync(path).size > 8 * 1024 * 1024) return false;
  return secretPattern.test(readFileSync(path, "utf8"));
});
const runtimePackage = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const devPackageDirs = ["tsx", "typescript"].filter((name) => {
  try {
    return statSync(join(appRoot, "node_modules", name)).isDirectory();
  } catch {
    return false;
  }
});
let nativeCompilerPackages = [];
try {
  nativeCompilerPackages = readdirSync(join(appRoot, "node_modules", "@typescript"))
    .filter((name) => name === "typescript" || name.startsWith("typescript-"));
} catch {
  // An absent optional compiler scope is the expected production state.
}
let compilerBinEntries = [];
try {
  compilerBinEntries = readdirSync(join(appRoot, "node_modules", ".bin"))
    .filter((name) => /^(?:tsc|tsserver)(?:\.|$)/i.test(name));
} catch {
  // A package closure is allowed to have no .bin directory.
}
const nativeCompilerExecutables = files.filter((path) => /(?:^|[\\/])tsc\.exe$/i.test(path));
const extractedBytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
const result = {
  archivePath,
  archiveBytes: statSync(archivePath).size,
  archiveMiB: Number((statSync(archivePath).size / 1024 / 1024).toFixed(2)),
  extractedBytes,
  extractedMiB: Number((extractedBytes / 1024 / 1024).toFixed(2)),
  sha256: actualHash,
  hashMatches: actualHash === expectedHash,
  packagedVersion: manifest.version,
  nonDependencyRuntimeSources: runtimeSources.length,
  privateStateFileNames: privateStateNames.length,
  secretContentHits: secretContentHits.length,
  secretContentPaths: secretContentHits.map((path) => relative(portableRoot, path)),
  hasDevDependencies: Boolean(runtimePackage.devDependencies),
  devPackageDirs,
  nativeCompilerPackages,
  compilerBinEntries,
  nativeCompilerExecutables: nativeCompilerExecutables.map((path) => relative(portableRoot, path)),
};
console.log(JSON.stringify(result));
if (!result.hashMatches || runtimeSources.length || privateStateNames.length || secretContentHits.length
  || result.hasDevDependencies || devPackageDirs.length || nativeCompilerPackages.length
  || compilerBinEntries.length || nativeCompilerExecutables.length) process.exitCode = 1;
