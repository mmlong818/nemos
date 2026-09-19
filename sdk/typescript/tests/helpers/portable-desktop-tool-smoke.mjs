import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const sdkRoot = resolve(process.argv[2] ?? ".");
const portableRoot = resolve(process.argv[3]);
const clientRoot = join(sdkRoot, "examples", "companion", "client");
const runtimeLock = JSON.parse(readFileSync(join(clientRoot, "runtime-lock.json"), "utf8"));
const frameworkRoot = process.env.WINDIR ?? "C:\\Windows";
const compiler = [
  join(frameworkRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(frameworkRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find(existsSync);
if (!compiler) throw new Error(".NET Framework csc.exe is required");

const root = mkdtempSync(join(tmpdir(), "clownfish-desktop-tool-"));
const sdkDirectory = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "lib", "net462");
const coreDll = join(sdkDirectory, "Microsoft.Web.WebView2.Core.dll");
const winFormsDll = join(sdkDirectory, "Microsoft.Web.WebView2.WinForms.dll");
const loaderDll = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "runtimes", "win-x64", "native", "WebView2Loader.dll");
for (const path of [coreDll, winFormsDll, loaderDll]) copyFileSync(path, join(root, path.split(/[\\/]/).pop()));
cpSync(join(portableRoot, "desktop-helper"), join(root, "desktop-helper"), { recursive: true });
const executable = join(root, "desktop-tool-smoke.exe");
execFileSync(compiler, [
  "/nologo", "/target:exe", "/platform:x64", "/optimize+", "/define:CLOWNFISH_RELEASE",
  "/main:ClownfishClient.PortableDesktopToolHarness", `/out:${executable}`,
  "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll",
  "/reference:System.Security.dll", "/reference:System.Windows.Forms.dll",
  `/reference:${coreDll}`, `/reference:${winFormsDll}`,
  join(clientRoot, "src", "ClownfishClient.cs"),
  join(sdkRoot, "tests", "helpers", "portable-desktop-tool-harness.cs"),
], { stdio: "pipe" });
const dataRoot = join(root, "data");
const output = execFileSync(executable, [], {
  encoding: "utf8",
  windowsHide: true,
  env: { ...process.env, CLOWNFISH_HOME: dataRoot },
  timeout: 60_000,
}).trim();
const result = JSON.parse(output.split(/\r?\n/).at(-1));
result.dataRoot = dataRoot;
result.unifiedHelperDataCreated = existsSync(join(dataRoot, "desktop-helper", "data.json"));
result.smokeRoot = root;
console.log(JSON.stringify(result));
if (!result.success || !result.unifiedHelperDataCreated) process.exitCode = 1;
