// renderer.js — 右侧 5 层分级面板渲染

import { LAYERS, list, dumpAll, counts } from "./storage.js";

const LAYER_LABELS = {
  archival: "Archival",
  episodic: "Episodic",
  semantic: "Semantic",
  personal_semantic: "Personal Semantic",
  procedural: "Procedural",
};

let filterAuthTrue = true;
let filterAuthFalse = true;

export function bindFilters(onChange) {
  document.getElementById("filter-auth-true").addEventListener("change", (e) => {
    filterAuthTrue = e.target.checked;
    onChange();
  });
  document.getElementById("filter-auth-false").addEventListener("change", (e) => {
    filterAuthFalse = e.target.checked;
    onChange();
  });
}

export async function renderAll() {
  let total = 0;
  for (const layer of LAYERS) {
    const items = await list(layer);
    const filtered = items.filter(m => {
      const auth = m.source?.authoritative;
      if (auth === true && !filterAuthTrue) return false;
      if (auth === false && !filterAuthFalse) return false;
      return true;
    });
    renderLayer(layer, filtered, items.length);
    total += filtered.length;
  }
  document.getElementById("total-count").textContent = total;
}

function renderLayer(layer, items, totalInLayer) {
  const container = document.getElementById(`layer-${layer}`);
  const countEl = document.getElementById(`count-${layer}`);
  countEl.textContent = totalInLayer;

  container.innerHTML = "";
  for (const mem of items) {
    container.appendChild(renderItem(mem));
  }
}

function renderItem(mem) {
  const el = document.createElement("div");
  el.className = "mem-item";
  el.dataset.id = mem.id;
  el.addEventListener("click", () => showDetail(mem));

  const content = document.createElement("div");
  content.className = "mem-content";
  content.textContent = mem.content || "(空内容)";
  el.appendChild(content);

  const meta = document.createElement("div");
  meta.className = "mem-meta";

  const authBadge = document.createElement("span");
  const isAuth = mem.source?.authoritative === true;
  authBadge.className = "mem-badge " + (isAuth ? "auth-true" : "auth-false");
  authBadge.textContent = isAuth ? "auth ✓" : "auth ✗ derived";
  meta.appendChild(authBadge);

  const scopeBadge = document.createElement("span");
  scopeBadge.className = "mem-badge scope";
  scopeBadge.textContent = mem.scope || "global";
  meta.appendChild(scopeBadge);

  const arousal = mem.arousal?.value;
  if (typeof arousal === "number") {
    const a = document.createElement("span");
    a.className = "mem-badge arousal";
    a.textContent = `arousal ${arousal.toFixed(2)}`;
    meta.appendChild(a);
  }

  const surprise = mem.surprise?.value;
  if (typeof surprise === "number") {
    const s = document.createElement("span");
    s.className = "mem-badge surprise";
    s.textContent = `surprise ${surprise.toFixed(2)}`;
    meta.appendChild(s);
  }

  const confidence = mem.source?.confidence;
  if (confidence) {
    const c = document.createElement("span");
    c.className = "mem-badge confidence-" + confidence;
    c.textContent = `conf: ${confidence}`;
    meta.appendChild(c);
  }

  const passCount = mem.source?.pass_count;
  if (typeof passCount === "number") {
    const p = document.createElement("span");
    p.className = "mem-badge pass-count";
    p.textContent = `passes: ${passCount}/2`;
    meta.appendChild(p);
  }

  el.appendChild(meta);
  return el;
}

function showDetail(mem) {
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");

  title.textContent = `${LAYER_LABELS[mem.layer || ""] || ""} · ${mem.id.slice(0, 8)}…`;
  body.textContent = JSON.stringify(mem, null, 2);
  modal.classList.remove("hidden");
}

export function bindModalClose() {
  document.getElementById("modal-close").addEventListener("click", () => {
    document.getElementById("modal").classList.add("hidden");
  });
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") {
      document.getElementById("modal").classList.add("hidden");
    }
  });
}
