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

function send(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) }); res.end(body); }
function authorized(req) { const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); const a = Buffer.from(supplied); const b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b); }
function userFile(req) { const user = String(req.headers["x-clownfish-user"] || "").trim(); if (!/^[a-zA-Z0-9._-]{1,80}$/.test(user)) throw new Error("invalid sync user"); return join(dataDir, `${createHash("sha256").update(user).digest("hex")}.json`); }
function revision(snapshot) { return `"${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}"`; }
async function body(req) { const chunks = []; let total = 0; for await (const chunk of req) { total += chunk.length; if (total > maxBytes) throw new Error("snapshot is too large"); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }

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
  } catch (error) { return send(res, error?.message === "snapshot is too large" ? 413 : 400, { error: error instanceof Error ? error.message : String(error) }); }
}).listen(port, "0.0.0.0", () => console.log(`Clownfish sync service listening on ${port}`));
