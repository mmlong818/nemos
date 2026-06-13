// app.js — 主控制器：粘合 UI、storage、analyzer、renderer
import { write, dumpAll, clearAll, LAYERS } from "./storage.js";
import { analyze, analyzeWithVerification } from "./analyzer.js";
import { renderAll, bindFilters, bindModalClose } from "./renderer.js";

// ===== 状态 =====
const LS_KEYS = {
  mode: "mnemos-poc.mode",
  apiKey: "mnemos-poc.apiKey",
  verifyMode: "mnemos-poc.verifyMode",
};

let analyzerMode = localStorage.getItem(LS_KEYS.mode) || "mock";
let apiKey = localStorage.getItem(LS_KEYS.apiKey) || "";
let verifyMode = localStorage.getItem(LS_KEYS.verifyMode) === "true";

// ===== UI 元素 =====
const $ = (id) => document.getElementById(id);
const elMode = $("analyzer-mode");
const elApiKey = $("api-key");
const elContent = $("input-content");
const elScope = $("input-scope");
const elAnalyzeBtn = $("btn-analyze");
const elExportBtn = $("btn-export");
const elClearBtn = $("btn-clear");
const elLog = $("log");
const elVerifyMode = $("verify-mode");

// ===== 初始化 =====
function needsApiKey(mode) {
  return mode === "anthropic" || mode === "openai";
}

async function syncToBridge() {
  // 把当前全量状态 POST 到 claude-bridge /sync，让主会话 Claude 可读 state.json
  try {
    const dump = await dumpAll();
    const payload = {
      mnemos_version: "0.1",
      exported_at: new Date().toISOString(),
      layers: dump,
    };
    const resp = await fetch("http://localhost:3001/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const data = await resp.json();
      const cs = Object.entries(data.counts || {}).map(([k, v]) => `${k}=${v}`).join(", ");
      log(`↻ 已同步到 bridge (${cs})`, "info");
    } else {
      log(`⚠ bridge sync 返回 ${resp.status}`, "warn");
    }
  } catch (e) {
    // bridge 没跑就静默——纯 mock/local 模式下不需要 bridge
    log(`⚠ 未同步到 bridge（${e.message}）— 启动 claude-bridge.py 后 Claude 才能读你的结果`, "warn");
  }
}

function init() {
  elMode.value = analyzerMode;
  elApiKey.value = apiKey;
  elApiKey.disabled = !needsApiKey(analyzerMode);
  elVerifyMode.checked = verifyMode;

  elVerifyMode.addEventListener("change", (e) => {
    verifyMode = e.target.checked;
    localStorage.setItem(LS_KEYS.verifyMode, String(verifyMode));
    log(`双 pass + 校验：${verifyMode ? "开" : "关"}` + (verifyMode ? "（3× LLM 调用，更稳）" : ""), "info");
  });

  elMode.addEventListener("change", (e) => {
    analyzerMode = e.target.value;
    localStorage.setItem(LS_KEYS.mode, analyzerMode);
    elApiKey.disabled = !needsApiKey(analyzerMode);
    log(`分析器切换到：${analyzerMode}`, "info");
    if (analyzerMode === "claude-cli") {
      log("注意：claude-cli 模式需要本地 bridge 跑着 → python claude-bridge.py", "warn");
    }
  });

  elApiKey.addEventListener("change", (e) => {
    apiKey = e.target.value.trim();
    localStorage.setItem(LS_KEYS.apiKey, apiKey);
    if (apiKey) log("API key 已保存到 localStorage（仅本浏览器）", "info");
  });

  elAnalyzeBtn.addEventListener("click", onAnalyze);
  elExportBtn.addEventListener("click", onExport);
  elClearBtn.addEventListener("click", onClear);

  bindFilters(renderAll);
  bindModalClose();

  renderAll();

  log("初始化完成。当前模式：" + analyzerMode, "ok");
}

// ===== 操作 =====
async function onAnalyze() {
  const content = elContent.value;
  const scope = elScope.value.trim() || "global";

  if (!content.trim()) {
    log("空内容，无法分析", "warn");
    return;
  }

  elAnalyzeBtn.disabled = true;
  elAnalyzeBtn.textContent = "分析中…";

  try {
    const useVerify = verifyMode && analyzerMode !== "mock";
    log(`开始分析（${analyzerMode}${useVerify ? " · 双pass+校验" : ""}）：${content.slice(0, 60)}…`, "info");
    const result = useVerify
      ? await analyzeWithVerification(content, scope, { mode: analyzerMode, apiKey })
      : await analyze(content, scope, { mode: analyzerMode, apiKey });

    if (result.verification_stats) {
      const s = result.verification_stats;
      log(`📊 校验统计: pass_a=${s.pass_a_count}, pass_b=${s.pass_b_count} → merged=${s.merged_count} (high=${s.high_confidence}, medium=${s.medium_confidence}, conflicts=${s.conflicts || 0})`, "ok");
    }

    // 写 archival（必有）
    await write("archival", { ...result.archival, layer: "archival" });
    log(`✓ archival 写入 1 条`, "ok");

    // 写 derived
    const counts = { episodic: 0, semantic: 0, personal_semantic: 0, procedural: 0 };
    for (const d of result.derived) {
      if (!LAYERS.includes(d.layer)) {
        log(`⚠ 忽略未知 layer: ${d.layer}`, "warn");
        continue;
      }
      if (d.layer === "archival") {
        log(`⚠ 忽略 derived 中的 archival（archival 仅原文）`, "warn");
        continue;
      }
      // 安全检查：personal_semantic 必须是 derived
      if (d.layer === "personal_semantic" && d.source?.authoritative === true) {
        log(`⚠ personal_semantic 不接受 authoritative 派生（违反 mnemos I4 不变量），降级为 episodic`, "warn");
        d.layer = "episodic";
      }
      await write(d.layer, { ...d });
      counts[d.layer]++;
    }
    const summary = Object.entries(counts).filter(([_, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(", ");
    log(`✓ derived 写入: ${summary || "(无)"}`, "ok");

    elContent.value = "";
    await renderAll();
    await syncToBridge();
  } catch (e) {
    log("✗ 分析失败：" + e.message, "err");
    console.error(e);
  } finally {
    elAnalyzeBtn.disabled = false;
    elAnalyzeBtn.textContent = "分析并存入";
  }
}

async function onExport() {
  const dump = await dumpAll();
  const exportData = {
    mnemos_version: "0.1",
    exported_at: new Date().toISOString(),
    format: "json-ld-lite",
    layers: dump,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemos-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log("已导出 JSON", "ok");
}

async function onClear() {
  if (!confirm("确认清空所有 layer 的全部 memory？此操作不可撤销。")) return;
  await clearAll();
  await renderAll();
  await syncToBridge();
  log("✓ 已清空所有 memory", "ok");
}

// ===== 日志 =====
function log(msg, level = "info") {
  const el = document.createElement("div");
  el.className = "log-entry log-" + level;
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  el.textContent = `[${time}] ${msg}`;
  elLog.appendChild(el);
  elLog.scrollTop = elLog.scrollHeight;
  // 保持最多 50 条
  while (elLog.children.length > 50) {
    elLog.removeChild(elLog.firstChild);
  }
}

// ===== 启动 =====
init();
