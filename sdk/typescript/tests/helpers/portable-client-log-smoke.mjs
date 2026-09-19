import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const sdkRoot = resolve(process.argv[2] ?? ".");
const clientRoot = join(sdkRoot, "examples", "companion", "client");
const runtimeLock = JSON.parse(readFileSync(join(clientRoot, "runtime-lock.json"), "utf8"));
const frameworkRoot = process.env.WINDIR ?? "C:\\Windows";
const compiler = [
  join(frameworkRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(frameworkRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find(existsSync);
if (!compiler) throw new Error(".NET Framework csc.exe is required");

const root = mkdtempSync(join(tmpdir(), "clownfish-client-log-"));
const sdkDirectory = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "lib", "net462");
const coreDll = join(sdkDirectory, "Microsoft.Web.WebView2.Core.dll");
const winFormsDll = join(sdkDirectory, "Microsoft.Web.WebView2.WinForms.dll");
const loaderDll = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "runtimes", "win-x64", "native", "WebView2Loader.dll");
for (const path of [coreDll, winFormsDll, loaderDll]) copyFileSync(path, join(root, path.split(/[\\/]/).pop()));

const outputs = [];
for (const build of [
  { name: "release", define: "CLOWNFISH_RELEASE", expected: "false" },
  { name: "development", define: "CLOWNFISH_DEVELOPMENT", expected: "true" },
]) {
  const executable = join(root, `${build.name}.exe`);
  execFileSync(compiler, [
    "/nologo", "/target:exe", "/platform:x64", "/optimize+", `/define:${build.define}`,
    "/main:ClownfishClient.PortableClientLogHarness", `/out:${executable}`,
    "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll",
    "/reference:System.Security.dll", "/reference:System.Windows.Forms.dll",
    `/reference:${coreDll}`, `/reference:${winFormsDll}`,
    join(clientRoot, "src", "ClownfishClient.cs"),
    join(sdkRoot, "tests", "helpers", "portable-client-log-harness.cs"),
  ], { stdio: "pipe" });
  outputs.push(execFileSync(executable, [build.expected, join(root, `${build.name}-logs`)], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  }).trim());
}

console.log(JSON.stringify({
  success: outputs.length === 2 && outputs.every((value) => value.startsWith("PASS ")),
  outputs,
  smokeRoot: root,
}));
