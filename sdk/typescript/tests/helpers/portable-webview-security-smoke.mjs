import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const sdkRoot = resolve(process.argv[2] ?? ".");
const clientRoot = join(sdkRoot, "examples", "companion", "client");
const runtimeLock = JSON.parse(readFileSync(join(clientRoot, "runtime-lock.json"), "utf8"));
const frameworkRoot = process.env.WINDIR ?? "C:\\Windows";
const compiler = [
  join(frameworkRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  join(frameworkRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find(existsSync);
if (!compiler) throw new Error(".NET Framework csc.exe is required");

const token = "webview-security-smoke-token-4e933c";
const execFileAsync = promisify(execFile);
const observations = [];
let evilBaseUrl = "";
const trustedServer = createServer((request, response) => {
  observations.push({ server: "trusted", path: request.url, token: request.headers["x-clownfish-client"] ?? null });
  if (request.url === "/test") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><img src="/same"><img src="${evilBaseUrl}/subresource"><iframe src="${evilBaseUrl}/frame"></iframe><script>chrome.webview.postMessage('trusted-message');setTimeout(()=>location.href='/redirect',800);</script>`);
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { location: `${evilBaseUrl}/redirect-target` });
    response.end();
    return;
  }
  response.statusCode = 204;
  response.end();
});
const evilServer = createServer((request, response) => {
  observations.push({ server: "evil", path: request.url, token: request.headers["x-clownfish-client"] ?? null });
  if (request.url === "/frame" || request.url === "/message-top") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<!doctype html><script>chrome.webview.postMessage('capture-screen')</script>");
    return;
  }
  response.statusCode = 204;
  response.end();
});

const listen = (server) => new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
});
const close = (server) => new Promise((resolveClose) => server.close(resolveClose));
const root = mkdtempSync(join(tmpdir(), "clownfish-webview-security-"));
try {
  const evilPort = await listen(evilServer);
  evilBaseUrl = `http://127.0.0.1:${evilPort}`;
  const trustedPort = await listen(trustedServer);
  const trustedBaseUrl = `http://127.0.0.1:${trustedPort}`;
  const sdkDirectory = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "lib", "net462");
  const coreDll = join(sdkDirectory, "Microsoft.Web.WebView2.Core.dll");
  const winFormsDll = join(sdkDirectory, "Microsoft.Web.WebView2.WinForms.dll");
  const loaderDll = join(clientRoot, "vendor", "webview2", runtimeLock.webView2Sdk.version, "runtimes", "win-x64", "native", "WebView2Loader.dll");
  for (const path of [coreDll, winFormsDll, loaderDll]) copyFileSync(path, join(root, path.split(/[\\/]/).pop()));
  const executable = join(root, "security-smoke.exe");
  execFileSync(compiler, [
    "/nologo", "/target:exe", "/platform:x64", "/optimize+", "/define:CLOWNFISH_RELEASE",
    "/main:ClownfishClient.PortableWebViewSecurityHarness", `/out:${executable}`,
    "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll",
    "/reference:System.Security.dll", "/reference:System.Windows.Forms.dll",
    `/reference:${coreDll}`, `/reference:${winFormsDll}`,
    join(clientRoot, "src", "ClownfishClient.cs"),
    join(sdkRoot, "tests", "helpers", "portable-webview-security-harness.cs"),
  ], { stdio: "pipe" });
  let harnessOutput;
  try {
    const completed = await execFileAsync(executable, [trustedBaseUrl, evilBaseUrl, token, join(root, "profile")], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, CLOWNFISH_HOME: join(root, "data") },
      timeout: 60_000,
    });
    harnessOutput = completed.stdout.trim();
  } catch (error) {
    console.error(String(error.stdout ?? ""));
    console.error(String(error.stderr ?? ""));
    throw error;
  }
  const harness = JSON.parse(harnessOutput.split(/\r?\n/).at(-1));
  const trustedRequests = observations.filter((entry) => entry.server === "trusted");
  const evilRequests = observations.filter((entry) => entry.server === "evil");
  const result = {
    harness,
    trustedRequests: trustedRequests.length,
    trustedRequestsWithToken: trustedRequests.filter((entry) => entry.token === token).length,
    evilRequests: evilRequests.length,
    evilRequestsWithToken: evilRequests.filter((entry) => entry.token === token).length,
    evilMessageFrameLoaded: evilRequests.some((entry) => entry.path === "/frame"),
    redirectTargetRequested: evilRequests.some((entry) => entry.path === "/redirect-target"),
    smokeRoot: root,
  };
  console.log(JSON.stringify(result));
  if (harness.trustedMessages < 1 || harness.rejectedMessages < 1 || harness.externalNavigationsBlocked < 1
    || result.trustedRequestsWithToken !== result.trustedRequests || result.evilRequestsWithToken !== 0
    || !result.evilMessageFrameLoaded) process.exitCode = 1;
} finally {
  await close(trustedServer);
  await close(evilServer);
}
