// storage.js — IndexedDB wrapper，5 层独立 store + 全局元数据
// 简化实现：纯 Promise，没用 Dexie 之类的库，方便审计。

const DB_NAME = "mnemos-poc";
const DB_VERSION = 1;
const LAYERS = ["archival", "episodic", "semantic", "personal_semantic", "procedural"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (const layer of LAYERS) {
        if (!db.objectStoreNames.contains(layer)) {
          const store = db.createObjectStore(layer, { keyPath: "id" });
          store.createIndex("created_at", "created_at");
          store.createIndex("scope", "scope");
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * 写入一条 memory 到对应 layer。
 * @param {string} layer
 * @param {object} memory - 必含 content；id/created_at 自动补
 */
export async function write(layer, memory) {
  if (!LAYERS.includes(layer)) throw new Error("invalid layer: " + layer);
  const db = await openDb();
  const record = {
    id: memory.id || uuidv4(),
    created_at: memory.created_at || new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    stability: 1.0,
    schema_version: "0.1",
    ...memory,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(layer, "readwrite");
    tx.objectStore(layer).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 读取某 layer 所有 memory，按 created_at 倒序。
 */
export async function list(layer) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(layer, "readonly");
    const req = tx.objectStore(layer).getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      arr.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 列出所有 layer 的统计。
 */
export async function counts() {
  const result = {};
  for (const layer of LAYERS) {
    result[layer] = (await list(layer)).length;
  }
  return result;
}

/**
 * 取所有 layer 的全部 memory，返回 {layer: [...]} 结构。
 */
export async function dumpAll() {
  const result = {};
  for (const layer of LAYERS) {
    result[layer] = await list(layer);
  }
  return result;
}

/**
 * 清空所有 layer。
 */
export async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LAYERS, "readwrite");
    for (const layer of LAYERS) {
      tx.objectStore(layer).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 取单条（按 id）。
 */
export async function get(layer, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(layer, "readonly");
    const req = tx.objectStore(layer).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export { LAYERS };
