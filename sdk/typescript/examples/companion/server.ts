// examples/companion/server.ts — 陪伴 App 网页服务（微信式界面）
//
// 跑：
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/server.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/server.ts
// 然后浏览器打开 http://localhost:8787
//
// 无 key 也能开（离线兜底，仍演示拓扑）。记忆持久化到 COMPANION_DB，跨次保留。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Nemos } from "../../src/index.js";
import { CompanionEngine, personaNamespace } from "./engine.js";
import { PERSONAS, RELATIONSHIPS, DEFAULT_RELATIONSHIP } from "./personas.js";
import { resolveLLM } from "./llm.js";

const PORT = Number(process.env.PORT || 8787);
const USER = process.env.COMPANION_USER || "me";
const DB = process.env.COMPANION_DB || "companion-web.db";

const llm = resolveLLM();
const mem = new Nemos({
  storage: { type: "sqlite", path: DB },
  llm: llm.extraction,
  embedding: llm.embedding,
  features: { doubleCheck: false },
  // 在线服务：worker 轮询跑后台抽取（配合 engine asyncIngest），回复不等抽取。
  // maxAttempts 调高：抽取撞到瞬时 429（限流/模型过载）时多重试几次，避免记忆静默丢失。
  worker: { pollIntervalMs: 400, maxAttempts: 6 },
});
const engine = new CompanionEngine(mem, PERSONAS, llm.chat, {
  asyncIngest: true,
  chatStream: llm.chatStream ?? undefined,
});
const groups: Array<{ id: string; members: string[] }> = [];
// 每个角色当前的关系（单用户 demo，按 personaId 记）。
// relOf 只装「已确认」的角色 → personaId 在其中 = 关系已锁定（首次聊天前确认一次，之后不再显示切换）。
const relOf = new Map<string, string>();
const REL_FILE = process.env.COMPANION_REL || "companion-rel.json";

function loadRel(): void {
  try {
    if (existsSync(REL_FILE)) {
      const o = JSON.parse(readFileSync(REL_FILE, "utf8")) as Record<string, string>;
      for (const [k, v] of Object.entries(o)) if (RELATIONSHIPS.some((r) => r.id === v)) relOf.set(k, v);
    }
  } catch { /* ignore */ }
}
function saveRel(): void {
  try { writeFileSync(REL_FILE, JSON.stringify(Object.fromEntries(relOf))); } catch { /* ignore */ }
}

function applyRel(personaId: string): void {
  const relId = relOf.get(personaId) ?? DEFAULT_RELATIONSHIP;
  const rel = RELATIONSHIPS.find((r) => r.id === relId) ?? RELATIONSHIPS[0]!;
  engine.setRelationship(USER, personaId, rel.setting);
}

// 调试期：人设可在网页里改并持久化（覆盖 personas.ts 的默认）。
const PERSONA_FILE = process.env.COMPANION_PERSONAS || "companion-personas.json";
function loadPersonaOverrides(): void {
  try {
    if (existsSync(PERSONA_FILE)) {
      const arr = JSON.parse(readFileSync(PERSONA_FILE, "utf8")) as Array<{ id: string; name?: string; persona?: string; verbosity?: "terse" | "normal" | "talkative" }>;
      for (const o of arr) {
        try { engine.updatePersona(o.id, { name: o.name, persona: o.persona, verbosity: o.verbosity }); } catch { /* 未知 id 跳过 */ }
      }
    }
  } catch { /* ignore */ }
}
function savePersonaOverrides(): void {
  try { writeFileSync(PERSONA_FILE, JSON.stringify(engine.listPersonas(), null, 2)); } catch { /* ignore */ }
}

// 熟悉度（累计互动量）持久化 —— 陪伴系统重启不该"重新变陌生"。
const FAM_FILE = process.env.COMPANION_FAM || "companion-familiarity.json";
function loadFam(): void {
  try { if (existsSync(FAM_FILE)) engine.importTurns(JSON.parse(readFileSync(FAM_FILE, "utf8"))); } catch { /* ignore */ }
}
function saveFam(): void {
  try { writeFileSync(FAM_FILE, JSON.stringify(engine.exportTurns())); } catch { /* ignore */ }
}

// 群持久化 —— 用户建的群重启后还在。
const GROUPS_FILE = process.env.COMPANION_GROUPS || "companion-groups.json";
function loadGroups(): void {
  try {
    if (existsSync(GROUPS_FILE)) {
      const arr = JSON.parse(readFileSync(GROUPS_FILE, "utf8")) as Array<{ id: string; members: string[] }>;
      for (const g of arr) {
        try { engine.createGroup(g.id, g.members); groups.push(g); } catch { /* 含未知角色则跳过 */ }
      }
    }
  } catch { /* ignore */ }
}
function saveGroups(): void {
  try { writeFileSync(GROUPS_FILE, JSON.stringify(groups)); } catch { /* ignore */ }
}

async function boot(): Promise<void> {
  // 不预置默认记忆、也不预设关系。加载人设覆盖 + 已确认的关系（均持久化）。
  loadPersonaOverrides();
  loadRel();
  loadFam();
  loadGroups();
  for (const [pid] of relOf) applyRel(pid);
}

function send(res: ServerResponse, code: number, body: unknown, type = "application/json"): void {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface ChatBody {
  target: { kind: "persona" | "group"; id: string };
  text: string;
  voice?: boolean;
  image?: string; // base64 data URL（识图）
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      send(res, 200, readFileSync(join(__dirname, "web", "index.html"), "utf-8"), "text/html");
      return;
    }
    if (req.method === "GET" && url === "/api/state") {
      send(res, 200, {
        live: llm.live,
        label: llm.label,
        user: USER,
        personas: PERSONAS.map((p) => ({ id: p.id, name: p.name, tag: p.tag, familiarity: engine.familiarityStage(USER, p.id) })),
        relationships: RELATIONSHIPS.map((r) => ({ id: r.id, label: r.label })),
        relationOf: Object.fromEntries(relOf),
        groups,
      });
      return;
    }
    if (req.method === "POST" && url === "/api/relationship") {
      const b = (await readBody(req)) as { personaId: string; relationship: string };
      if (!RELATIONSHIPS.some((r) => r.id === b.relationship)) {
        send(res, 400, { error: "unknown relationship" });
        return;
      }
      relOf.set(b.personaId, b.relationship);
      applyRel(b.personaId);
      saveRel(); // 持久化：确认即锁定，跨刷新/重启保留
      send(res, 200, { ok: true, personaId: b.personaId, relationship: b.relationship });
      return;
    }
    if (req.method === "GET" && url.split("?")[0] === "/api/memory") {
      // who=me（用户真相库，默认）或 persona:<id>（某角色自己的记忆库）
      const qWho = new URLSearchParams(url.split("?")[1] || "").get("who") || USER;
      const who = qWho === USER || PERSONAS.some((p) => personaNamespace(p.id) === qWho) ? qWho : USER;
      const store = mem.forUser(who);
      const facts: Array<{ layer: string; who: string; content: string; created: string }> = [];
      // archival=原文/归档；其余为分类后的记忆层
      for (const layer of ["personal_semantic", "semantic", "episodic", "procedural", "archival"]) {
        const items = await store.listByLayer(layer as never, { limit: 500 });
        for (const m of items) {
          const tail = m.scope.split(":").pop() ?? m.scope;
          const speaker = PERSONAS.find((p) => p.id === tail)?.name ?? tail;
          facts.push({ layer, who: speaker, content: m.content, created: m.created_at });
        }
      }
      facts.sort((a, b) => b.created.localeCompare(a.created));
      send(res, 200, { facts, owner: who });
      return;
    }
    if (req.method === "POST" && url === "/api/clear") {
      // who=me（用户库）/ persona:<id>（某角色库）/ all 或缺省（全部）。archival 原文受 SDK 保护不可删，只清分类层。
      const b = (await readBody(req)) as { who?: string };
      const clearLayers = async (ns: string): Promise<number> => {
        const store = mem.forUser(ns);
        let n = 0;
        for (const layer of ["episodic", "semantic", "personal_semantic", "procedural"]) {
          const items = await store.listByLayer(layer as never, { limit: 100000 });
          for (const m of items) { try { await store.forget(m.id); n++; } catch { /* skip */ } }
        }
        return n;
      };
      let cleared = 0;
      const who = b.who;
      if (who === USER) {
        cleared += await clearLayers(USER);
      } else if (who && PERSONAS.some((p) => personaNamespace(p.id) === who)) {
        cleared += await clearLayers(who);
      } else {
        // all / 缺省：用户库 + 所有角色库
        cleared += await clearLayers(USER);
        for (const p of PERSONAS) cleared += await clearLayers(personaNamespace(p.id));
      }
      send(res, 200, { ok: true, cleared });
      return;
    }
    if (req.method === "GET" && url === "/api/personas/full") {
      send(res, 200, { personas: engine.listPersonas() });
      return;
    }
    if (req.method === "POST" && url === "/api/persona") {
      const b = (await readBody(req)) as { id: string; name?: string; persona?: string; verbosity?: "terse" | "normal" | "talkative" };
      try {
        engine.updatePersona(b.id, { name: b.name, persona: b.persona, verbosity: b.verbosity });
        savePersonaOverrides();
        send(res, 200, { ok: true });
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (req.method === "POST" && url === "/api/group") {
      const b = (await readBody(req)) as { id: string; members: string[] };
      engine.createGroup(b.id, b.members);
      if (!groups.some((g) => g.id === b.id)) groups.push({ id: b.id, members: b.members });
      saveGroups();
      send(res, 200, { ok: true, groups });
      return;
    }
    if (req.method === "POST" && url === "/api/tts") {
      if (!llm.tts) { send(res, 503, { error: "TTS 不可用（离线模式）" }); return; }
      const b = (await readBody(req)) as { personaId: string; text: string };
      const voice = PERSONAS.find((p) => p.id === b.personaId)?.voice || "tongtong";
      try {
        const audio = await llm.tts(b.text || "", voice);
        res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length });
        res.end(audio);
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (req.method === "POST" && url === "/api/asr") {
      if (!llm.asr) { send(res, 503, { error: "ASR 不可用（离线模式）" }); return; }
      const mime = req.headers["content-type"] || "audio/webm";
      const audio = await readRawBody(req);
      const ext = /wav/.test(mime) ? "wav" : /mp3|mpeg/.test(mime) ? "mp3" : /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
      try {
        const text = await llm.asr(audio, "audio." + ext, mime);
        send(res, 200, { text });
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (req.method === "POST" && url === "/api/chat/stream") {
      const b = (await readBody(req)) as ChatBody;
      let text = b.text;
      if (b.image && llm.vision) {
        try {
          const desc = await llm.vision(b.image, "请客观、详细地描述这张图片的内容（文字、物体、场景、人物、情绪等）。");
          text = `${b.text?.trim() || "（看看这张图）"}\n\n[我发来一张图片，它的内容是：${desc}]`;
        } catch (e) {
          text = `${b.text?.trim() || ""}\n\n[我发来一张图片，但识图出错了：${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
      const ev = (o: unknown): void => { res.write(JSON.stringify(o) + "\n"); };
      try {
        const opts = b.voice ? { voice: { durationSec: Math.max(2, Math.round((b.text || "").length / 4)) } } : {};
        const r = await engine.sendStream(USER, b.target.id, text, opts, {
          onStatus: (s) => ev({ type: "status", text: s }),
          onToken: (t) => ev({ type: "token", text: t }),
        });
        ev({ type: "done", facts: bullets(r.context.userFacts) });
        saveFam();
      } catch (e) {
        ev({ type: "error", text: e instanceof Error ? e.message : String(e) });
      }
      res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/chat") {
      const b = (await readBody(req)) as ChatBody;
      const opts = b.voice ? { voice: { durationSec: Math.max(2, Math.round(b.text.length / 4)) } } : {};
      // 识图：有图先用视觉模型理解，把描述并进消息文本（角色据此回应，且进记忆）。
      let text = b.text;
      if (b.image && llm.vision) {
        try {
          const desc = await llm.vision(b.image, "请客观、详细地描述这张图片的内容（文字、物体、场景、人物、情绪等）。");
          text = `${b.text?.trim() || "（看看这张图）"}\n\n[我发来一张图片，它的内容是：${desc}]`;
        } catch (e) {
          text = `${b.text?.trim() || ""}\n\n[我发来一张图片，但识图出错了：${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      const out =
        b.target.kind === "persona"
          ? [await engine.send(USER, b.target.id, text, opts)]
          : await engine.sendToGroup(USER, b.target.id, text, opts);
      saveFam();
      send(res, 200, {
        replies: out.map((r) => ({
          personaId: r.personaId,
          name: PERSONAS.find((p) => p.id === r.personaId)?.name ?? r.personaId,
          reply: r.reply,
          messages: splitBubbles(r.reply), // 微信式：拆成多条气泡
          facts: bullets(r.context.userFacts),
        })),
      });
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

/** 从 getRelevantContext 的 markdown 里抽事实要点，给 UI 显示"TA 记得什么"。 */
function bullets(md: string): string[] {
  return [...md.matchAll(/^- (.+?)(?:\s+_.*_)?$/gm)].map((m) => m[1]!.trim());
}

/** 微信式：按空行把一段回复拆成多条气泡。无空行则整段为一条。 */
function splitBubbles(text: string): string[] {
  const parts = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text.trim() || "…"];
}

boot().then(() => {
  server.listen(PORT, () => {
    const startedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    console.log(`\n  陪伴 App 已启动 → http://localhost:${PORT}`);
    console.log(`  启动时间: ${startedAt}（北京时间）`);
    console.log(`  LLM: ${llm.label}`);
    console.log(`  记忆库: ${DB}\n`);
  });
});
