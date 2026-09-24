import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findChromiumExecutable } from "./presentation-visual-review.js";
import { injectWidgetBridge } from "./widgets.js";

/**
 * 交付前自测：在无头浏览器里打开页面，断网，点一遍按钮和勾选框，记下脚本报错。
 * 只回答"打开了没有、点了几个、有没有报错"，不评价好不好看；结论如实写进交付说明。
 */
export interface WidgetSelfCheck {
  status: "passed" | "failed" | "not-run";
  detail: string;
  errors: string[];
  controls: number;
  clicked: number;
}

const CLICK_THROUGH = `(async () => {
  const visible = (e) => !e.disabled && e.getClientRects().length > 0;
  const all = [...document.querySelectorAll('button, input[type=checkbox], input[type=radio], select, [role=button], [onclick]')];
  const targets = all.filter(visible).slice(0, 8);
  for (const e of targets) { e.click(); await new Promise((r) => setTimeout(r, 120)); }
  return { controls: all.length, clicked: targets.length, text: document.body ? document.body.innerText.trim().length : 0 };
})()`;

export async function selfCheckWidget(file: string, options: { timeoutMs?: number; executable?: string | null } = {}): Promise<WidgetSelfCheck> {
  if (process.env.NEMOS_DISABLE_BROWSER_CHECK === "1") return notRun("自测已按设置关闭");
  const executable = options.executable === undefined ? findChromiumExecutable() : options.executable;
  if (!executable) return notRun("本机没有找到 Edge 或 Chrome，没做浏览器自测");
  const profile = mkdtempSync(join(tmpdir(), "clownfish-widget-check-"));
  const child = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let socket: WebSocket | undefined;
  const timeout = options.timeoutMs ?? 20_000;
  try {
    return await withTimeout(run(), timeout);
  } catch (error) {
    return notRun(`浏览器自测没能完成：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { socket?.close(); } catch { /* ignore */ }
    child.kill();
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 临时目录，下次系统清理 */ } }, 500);
  }

  async function run(): Promise<WidgetSelfCheck> {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      child.stderr!.on("data", (chunk) => {
        buffer += String(chunk);
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
        if (match) resolve(match[1]);
      });
      child.once("exit", (code) => reject(new Error(`浏览器提前退出（${code}）`)));
      child.once("error", reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(new Error("连不上浏览器调试端口")); });
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const errors: string[] = [];
    const requests = new Map<string, string>();
    let dialogs = 0;
    let loaded: () => void = () => {};
    const loadedPromise = new Promise<void>((resolve) => { loaded = resolve; });
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id)!; pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        errors.push(String(details.exception?.description || details.text || "脚本异常").split("\n")[0]);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        errors.push(message.params.args.map((arg: { value?: unknown; description?: string }) => String(arg.value ?? arg.description ?? "")).join(" ").slice(0, 200));
      } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        errors.push(/BLOCKED_BY_CLIENT|blocked/i.test(entry.text) ? `页面想加载外部资源：${String(entry.url || "").slice(0, 120)}` : String(entry.text).slice(0, 200));
      } else if (message.method === "Network.requestWillBeSent") {
        requests.set(message.params.requestId, String(message.params.request?.url || ""));
      } else if (message.method === "Network.loadingFailed" && message.params.blockedReason) {
        const url = requests.get(message.params.requestId) || "";
        if (!url.startsWith("file:")) errors.push(`页面想加载外部资源：${url.slice(0, 120)}`);
      } else if (message.method === "Page.javascriptDialogOpening") {
        // 弹框会把无头浏览器卡住：自动点确定，记一笔（手机上弹框体验差，约定里不许用）。
        dialogs++;
        send("Page.handleJavaScriptDialog", { accept: true }, message.sessionId).catch(() => {});
      } else if (message.method === "Page.loadEventFired") {
        loaded();
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    for (const method of ["Runtime.enable", "Page.enable", "Log.enable", "Network.enable"]) await send(method, {}, sessionId);
    // 自测时一律断网：构件约定不联网，想联网的在这里会报"想加载外部资源"。
    await send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "ws://*", "wss://*"] }, sessionId);
    // 按线上的样子打开：注入同一份桥接脚本（它会换掉 localStorage），而不是直接开原文件。
    // 直接开原文件时浏览器自带的 localStorage 能用，沙箱里却会报错，自测就会说假话。
    const served = join(profile, "widget.html");
    writeFileSync(served, injectWidgetBridge(readFileSync(file, "utf8"), "self-check"), "utf8");
    await send("Page.navigate", { url: pathToFileURL(served).href }, sessionId);
    await Promise.race([loadedPromise, delay(8000)]);
    await delay(600);
    // 点到"重置"之类的按钮时页面可能自己刷新或跳转，求值会随之中断：这不算没做自测，记下来，照已收集到的报错下结论。
    let navigated = false;
    let result: any;
    try {
      result = await send("Runtime.evaluate", { expression: CLICK_THROUGH, awaitPromise: true, returnByValue: true }, sessionId);
    } catch (error) {
      if (!/navigat|closed|destroyed/i.test(error instanceof Error ? error.message : String(error))) throw error;
      navigated = true;
    }
    await delay(400);
    const summary = (result?.result?.value ?? { controls: 1, clicked: 1, text: 1 }) as { controls: number; clicked: number; text: number };
    const navigatedNote = navigated ? "；点控件时页面刷新或跳转了一次，之后的控件没点到" : "";
    const unique = [...new Set(errors)].slice(0, 5);
    if (unique.length) {
      return { status: "failed", detail: `自测发现 ${unique.length} 处问题：${unique.join("；")}${navigatedNote}`, errors: unique, controls: summary.controls, clicked: summary.clicked };
    }
    if (!summary.text && !summary.controls) {
      return { status: "failed", detail: "页面打开后是空的", errors: [], controls: 0, clicked: 0 };
    }
    const dialogNote = dialogs ? `；页面弹了 ${dialogs} 次确认框` : "";
    return {
      status: "passed",
      detail: (navigated ? "在浏览器里打开并点了控件，没有脚本报错" : summary.clicked ? `在浏览器里打开并点了 ${summary.clicked} 个控件，没有脚本报错` : "在浏览器里打开了，没有脚本报错（页面上没有可点的控件）") + dialogNote + navigatedNote,
      errors: [], controls: summary.controls, clicked: summary.clicked,
    };
  }
}

function notRun(detail: string): WidgetSelfCheck {
  return { status: "not-run", detail, errors: [], controls: 0, clicked: 0 };
}
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超过 ${Math.round(ms / 1000)} 秒`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
