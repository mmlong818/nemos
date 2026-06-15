// utils/vector.ts — 向量序列化与相似度（v0.5 抽出，解 router→storage 依赖）

/** Float32Array → BLOB（little-endian，复制底层 buffer 区段）。 */
export function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** BLOB → Float32Array。 */
export function bufferToFloat32(buf: Buffer): Float32Array {
  // 拷贝以避免与底层 Buffer 共享内存（better-sqlite3 复用读缓冲）
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/** 余弦相似度（本地朴素实现，个人量级够用）。零向量返回 0。 */
export function cosineSimLocal(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
