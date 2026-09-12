import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.PORT || 8799);
const dataDir = process.env.CLOWNFISH_SYNC_DATA || "/data";
const token = String(process.env.CLOWNFISH_SYNC_TOKEN || "");
const maxBytes = Number(process.env.CLOWNFISH_SYNC_MAX_BYTES || 134_217_728);
if (token.length < 24) throw new Error("CLOWNFISH_SYNC_TOKEN must contain at least 24 characters");
mkdirSync(dataDir, { recursive: true });

/**
 * 可以发给调用方的错误。与小丑鱼 send() 同一条规矩：只有本文件里自己写死的消息才外传。
 * 其余异常一概换成通用文案——JSON.parse 会带出内容与位置，fs 的错误会带出 dataDir 下的
 * 真实路径，这个服务是暴露在网络上的，那些都不该让调用方看到。
 */
class PublicError extends Error {
  constructor(message, status) { super(message); this.name = "PublicError"; this.status = status; }
}

function send(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) }); res.end(body); }
function authorized(req) { const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); const a = Buffer.from(supplied); const b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b); }
function userFile(req) { const user = String(req.headers["x-clownfish-user"] || "").trim(); if (!/^[a-zA-Z0-9._-]{1,80}$/.test(user)) throw new PublicError("invalid sync user", 400); return join(dataDir, `${createHash("sha256").update(user).digest("hex")}.json`); }
function revision(snapshot) { return `"${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}"`; }
async function body(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new PublicError("snapshot is too large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // 解析失败确实是调用方的问题，但解析器的报错会带出正文片段与位置，不能原样回。
    throw new PublicError("request body is not valid JSON", 400);
  }
}

createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") return send(res, 200, { ok: true, service: "clownfish-sync", version: 1 });
    if (req.url !== "/v1/snapshots/latest") return send(res, 404, { error: "not found" });
    if (!authorized(req)) return send(res, 401, { error: "invalid sync token" });
    const file = userFile(req);
    if (req.method === "GET") {
      if (!existsSync(file)) return send(res, 200, { snapshot: null, revision: "" });
      const snapshot = JSON.parse(readFileSync(file, "utf8"));
      const etag = revision(snapshot);
      res.setHeader("etag", etag);
      return send(res, 200, { snapshot, revision: etag });
    }
    if (req.method === "PUT") {
      const incoming = await body(req);
      if (incoming?.version !== 1 || !incoming.ciphertext || !incoming.sha256) return send(res, 400, { error: "invalid encrypted snapshot" });
      if (existsSync(file)) {
        const current = JSON.parse(readFileSync(file, "utf8"));
        const currentRevision = revision(current);
        const expected = String(req.headers["if-match"] || "");
        if (!expected) return send(res, 409, { error: "server already has data; pull it before the first upload", revision: currentRevision });
        if (expected !== currentRevision) return send(res, 409, { error: "server data changed on another device; pull before uploading", revision: currentRevision });
      }
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(incoming));
      renameSync(temporary, file);
      const nextRevision = revision(incoming);
      res.setHeader("etag", nextRevision);
      return send(res, 200, { ok: true, revision: nextRevision });
    }
    return send(res, 405, { error: "method not allowed" });
  } catch (error) {
    if (error instanceof PublicError) return send(res, error.status, { error: error.message });
    // 走到这里的都是没预料到的：损坏的快照文件、磁盘满、权限不足。原文里可能有 dataDir 下的
    // 真实路径，只写进服务端日志，回给调用方的是通用文案。
    console.error(`[clownfish-sync] ${req.method} ${req.url} failed:`, error instanceof Error ? error.stack || error.message : String(error));
    return send(res, 500, { error: "internal failure; see the service log" });
  }
}).listen(port, "0.0.0.0", () => console.log(`Clownfish sync service listening on ${port}`));
