import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

import {
  createConsistentPortableBackup,
  shouldCreateUpgradeBackup,
} from "../../examples/companion/portable-backup.js";

const sdkRoot = resolve(__dirname, "../..");
const clientRoot = join(sdkRoot, "examples", "companion", "client");

test("portable release pins runtimes and launches precompiled JavaScript", () => {
  const lock = JSON.parse(readFileSync(join(clientRoot, "runtime-lock.json"), "utf8")) as {
    mainNode: { version: string; sha256: string };
    mcpNode: { version: string; sha256: string };
    webView2Sdk: { nupkgSha256: string; coreDllSha256: string; winFormsDllSha256: string; loaderDllSha256: string };
  };
  const manifest = JSON.parse(readFileSync(join(clientRoot, "manifest.json"), "utf8")) as {
    server: { defaultPort: number; entry: string };
  };
  const build = readFileSync(join(clientRoot, "Build-Clownfish.ps1"), "utf8");
  const host = readFileSync(join(clientRoot, "src", "ClownfishClient.cs"), "utf8");
  const rootLauncher = readFileSync(join(clientRoot, "src", "ClownfishPortableLauncher.cs"), "utf8");
  const readme = readFileSync(resolve(sdkRoot, "../..", "README.md"), "utf8");
  const server = readFileSync(join(sdkRoot, "examples", "companion", "server.ts"), "utf8");

  assert.match(lock.mainNode.version, /^24\./);
  assert.match(lock.mainNode.sha256, /^[a-f0-9]{64}$/);
  assert.match(lock.mcpNode.sha256, /^[a-f0-9]{64}$/);
  for (const hash of [lock.webView2Sdk.nupkgSha256, lock.webView2Sdk.coreDllSha256, lock.webView2Sdk.winFormsDllSha256, lock.webView2Sdk.loaderDllSha256]) {
    assert.match(hash, /^[a-f0-9]{64}$/);
  }
  assert.equal(manifest.server.defaultPort, 0);
  assert.equal(manifest.server.entry, "app/examples/companion/portable-launcher.js");
  assert.doesNotMatch(build, /Get-Command node\.exe/);
  assert.match(host, /ResolvePackagedServerLaunch\(packageRoot\)/);
  assert.match(host, /Path\.Combine\(package, "node", "node\.exe"\)/);
  assert.match(host, /Path\.Combine\(app, "examples", "companion", "portable-launcher\.js"\)/);
  assert.match(host, /HardenPortableNodeEnvironment\(info, command\)/);
  assert.match(host, /key\.StartsWith\("npm_", StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(host, /string\.Equals\(key, "NODE_OPTIONS", StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(host, /#if CLOWNFISH_DEVELOPMENT[\s\S]*"npm\.cmd"[\s\S]*#else[\s\S]*ResolvePackagedServerLaunch\(packageRoot\)/);
  assert.match(rootLauncher, /AppContext\.BaseDirectory/);
  assert.match(rootLauncher, /"portable", "小丑鱼", "小丑鱼\.exe"/);
  assert.doesNotMatch(rootLauncher, /npm(?:\.cmd)?|sdk\\typescript|node_modules/i);
  assert.match(build, /PortableLauncherSource[\s\S]*Portable root launcher compilation failed/);
  assert.ok(
    build.lastIndexOf("$PortableLauncherSource") > build.indexOf("Copy-Item -LiteralPath $Exe -Destination $PortableRoot"),
    "the root EXE must be replaced by the safe launcher only after the real client is copied into portable",
  );
  assert.match(readme, /portable ZIP/);
  assert.match(readme, /完整解压/);
  assert.match(readme, /portable\\小丑鱼\\小丑鱼\.exe/);
  assert.match(build, /npm-cli\.js[\s\S]*ci --omit=dev --omit=peer/);
  assert.match(build, /OptionalPeerCompiler[\s\S]*node_modules\\typescript/);
  assert.match(build, /OptionalNativeCompilerScope[\s\S]*node_modules\\@typescript/);
  assert.match(build, /"tsc", "tsc\.cmd", "tsc\.ps1", "tsserver", "tsserver\.cmd", "tsserver\.ps1"/);
  assert.match(build, /RemainingNativeCompilers[\s\S]*Production dependency closure still contains TypeScript compiler artifacts/);
  assert.match(host, /CLOWNFISH_CLIENT_TOKEN/);
  assert.match(host, /CLOWNFISH_READY/);
  assert.match(host, /JobObjectLimitKillOnJobClose/);
  assert.match(host, /Local\\Clownfish\.Client/);
  assert.match(server, /delete process\.env\.CLOWNFISH_CLIENT_TOKEN/);
  assert.match(host, /GetAvailableBrowserVersionString/);
  assert.match(host, /https:\/\/developer\.microsoft\.com\/en-us\/microsoft-edge\/webview2\//);
  assert.match(host, /Uri\.UriSchemeHttps/);
  assert.match(host, /uri\.Host, "developer\.microsoft\.com"/);
  assert.match(host, /AreDefaultContextMenusEnabled = ClientBuildConfiguration\.DevelopmentFeatures/);
  assert.match(host, /AreDevToolsEnabled = ClientBuildConfiguration\.DevelopmentFeatures/);
  assert.match(host, /#if CLOWNFISH_DEVELOPMENT[\s\S]*DevelopmentFeatures = true[\s\S]*#else[\s\S]*DevelopmentFeatures = false/);
  assert.match(build, /CLOWNFISH_DEVELOPMENT_BUILD[\s\S]*\/define:CLOWNFISH_DEVELOPMENT[\s\S]*\/define:CLOWNFISH_RELEASE/);
  assert.match(host, /ServerLogMaxBytes = 4L \* 1024L \* 1024L/);
  assert.match(host, /RotateServerLogIfNeeded/);
  assert.match(host, /RedactServerLogText/);
  assert.doesNotMatch(host, /File\.AppendAllText\((?:logPath|errPath)/);
  assert.match(host, /compatibility discovery, not migration/);
  assert.match(host, /Path\.Combine\(root, "desktop-helper"\)/);
  assert.match(host, /Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.MyDocuments\), "DesktopHelperData"\)/);
  assert.match(host, /IsTrustedSidecarUri\(args\.Request\.Uri, port\)[\s\S]*SetHeader\("X-Clownfish-Client", clientToken\)[\s\S]*RemoveHeader\("X-Clownfish-Client"\)/);
  assert.match(host, /CoreWebView2\.NavigationStarting[\s\S]*IsTrustedSidecarUri\(args\.Uri, port\)[\s\S]*args\.Cancel = true/);
  assert.match(host, /CoreWebView2\.FrameNavigationStarting[\s\S]*IsTrustedSidecarUri\(args\.Uri, port\)/);
  assert.match(host, /WebMessageReceived[\s\S]*IsTrustedWebMessageSource\(args\.Source, webView\.CoreWebView2\.Source, port\)/);
  assert.match(host, /IsTrustedSidecarUri\(webView\.CoreWebView2\.Source, port\)/);
  assert.match(host, /IsSafeExternalHttpUri[\s\S]*Uri\.UriSchemeHttp[\s\S]*Uri\.UriSchemeHttps/);
  assert.match(host, /SetVirtualHostNameToFolderMapping\([\s\S]*"desktop-helper\.clownfish\.invalid"[\s\S]*CoreWebView2HostResourceAccessKind\.Deny/);
  assert.match(host, /Navigate\(DesktopToolOrigin \+ "\/index\.html"\)/);
  assert.doesNotMatch(host, /Navigate\(new Uri\(pagePath\)\.AbsoluteUri\)/);
  assert.match(host, /if \(window\.location\.origin !== 'https:\/\/desktop-helper\.clownfish\.invalid'\) return/);
  assert.match(host, /DesktopToolBridge\(this, IsTrustedCurrentDocument\)/);
  assert.ok((host.match(/EnsureTrustedOrigin\(\);/g) ?? []).length >= 12);
});

test("upgrade backup snapshots every database consistently and excludes volatile state", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-backup-test-"));
  try {
    const firstDbPath = join(root, "companion.db");
    const secondDbPath = join(root, "assistant-bots.db");
    const first = new Database(firstDbPath);
    const second = new Database(secondDbPath);
    try {
      first.pragma("journal_mode = WAL");
      first.exec("CREATE TABLE facts(value TEXT); INSERT INTO facts VALUES ('kept-in-wal')");
      second.exec("CREATE TABLE bots(value TEXT); INSERT INTO bots VALUES ('second-db')");
      writeFileSync(join(root, "relationships.json"), JSON.stringify({ kept: true }), "utf8");
      mkdirSync(join(root, "logs"));
      writeFileSync(join(root, "logs", "client-server.log"), "private log", "utf8");
      writeFileSync(join(root, "companion-server.pid"), "123", "utf8");

      const result = await createConsistentPortableBackup(root, "0.7.6", new Date("2026-09-14T10:20:30.000Z"));
      assert.equal(result.created, true);
      assert.ok(result.directory);
      assert.deepEqual(result.entries.map((entry) => entry.path).sort(), [
        "assistant-bots.db",
        "companion.db",
        "relationships.json",
      ]);

      const firstBackup = new Database(join(result.directory!, "companion.db"), { readonly: true });
      const secondBackup = new Database(join(result.directory!, "assistant-bots.db"), { readonly: true });
      try {
        assert.equal((firstBackup.prepare("SELECT value FROM facts").get() as { value: string }).value, "kept-in-wal");
        assert.equal((secondBackup.prepare("SELECT value FROM bots").get() as { value: string }).value, "second-db");
      } finally {
        firstBackup.close();
        secondBackup.close();
      }
      assert.equal(readFileSync(join(result.directory!, "relationships.json"), "utf8"), '{"kept":true}');
      assert.throws(() => readFileSync(join(result.directory!, "logs", "client-server.log"), "utf8"));
      assert.throws(() => readFileSync(join(result.directory!, "companion-server.pid"), "utf8"));
    } finally {
      first.close();
      second.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("same-version starts do not create another backup", () => {
  assert.equal(shouldCreateUpgradeBackup("0.7.6", "0.7.6"), false);
  assert.equal(shouldCreateUpgradeBackup("0.7.5", "0.7.6"), true);
  assert.equal(shouldCreateUpgradeBackup(null, "0.7.6"), true);
});

test("Windows host compiles in release/development modes and rotated logs stay redacted", {
  skip: process.platform !== "win32",
}, () => {
  const lock = JSON.parse(readFileSync(join(clientRoot, "runtime-lock.json"), "utf8")) as {
    webView2Sdk: { version: string };
  };
  const frameworkRoot = process.env.WINDIR ?? "C:\\Windows";
  const compilerCandidates = [
    join(frameworkRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(frameworkRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  const compiler = compilerCandidates.find(existsSync);
  assert.ok(compiler, "the Windows release gate requires the .NET Framework C# compiler");

  const sdkDir = join(clientRoot, "vendor", "webview2", lock.webView2Sdk.version, "lib", "net462");
  const coreDll = join(sdkDir, "Microsoft.Web.WebView2.Core.dll");
  const winFormsDll = join(sdkDir, "Microsoft.Web.WebView2.WinForms.dll");
  const source = join(clientRoot, "src", "ClownfishClient.cs");
  const harness = join(sdkRoot, "tests", "helpers", "portable-client-log-harness.cs");
  const root = mkdtempSync(join(tmpdir(), "clownfish-client-host-test-"));
  try {
    copyFileSync(coreDll, join(root, "Microsoft.Web.WebView2.Core.dll"));
    copyFileSync(winFormsDll, join(root, "Microsoft.Web.WebView2.WinForms.dll"));
    for (const mode of ["release", "development"] as const) {
      const executable = join(root, `${mode}.exe`);
      const define = mode === "development" ? "CLOWNFISH_DEVELOPMENT" : "CLOWNFISH_RELEASE";
      execFileSync(compiler, [
        "/nologo", "/target:exe", "/platform:x64", "/optimize+",
        `/define:${define}`, `/main:ClownfishClient.PortableClientLogHarness`, `/out:${executable}`,
        "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll",
        "/reference:System.Security.dll", "/reference:System.Windows.Forms.dll",
        `/reference:${coreDll}`, `/reference:${winFormsDll}`, source, harness,
      ], { stdio: "pipe" });
      const output = execFileSync(executable, [String(mode === "development"), join(root, `${mode}-logs`)], {
        encoding: "utf8",
        env: { ...process.env, CLOWNFISH_HOME: join(root, `${mode}-data`) },
      });
      assert.match(output, new RegExp(`PASS build=${mode} files=5`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
