import { createHmac, randomBytes } from 'node:crypto';

interface Waiter { grant: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }
interface Pool { active: number; waiting: Waiter[] }
export type ModelAdmissionState = 'waiting' | 'active' | 'released';
/** Process-wide admission for model requests, not durable task storage.
 * Own the slot only during a model response, never while a tool or human runs.
 */
export class ModelScheduler {
  private pools = new Map<string, Pool>();
  constructor(private readonly capacity = 1, private readonly maxWaiting = 128) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxWaiting) || maxWaiting < 1) throw Error('无效的模型队列配置');
  }
  snapshot(key: string) {
    const pool = this.pools.get(key);
    return {active: pool?.active ?? 0, waiting: pool?.waiting.length ?? 0};
  }
  private acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    let pool = this.pools.get(key);
    if (!pool) { pool = {active: 0, waiting: []}; this.pools.set(key, pool); }
    const current = pool;
    if (current.active >= this.capacity && current.waiting.length >= this.maxWaiting) return Promise.reject(Error('模型等待队列已满，请稍后重试'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {signal, reject, grant: () => {
        if (waiter.abort) signal?.removeEventListener('abort', waiter.abort);
        current.active++;
        let released = false;
        resolve(() => {
          if (released) return; released = true; current.active--;
          this.drain(key, current);
        });
      }};
      waiter.abort = () => {
        const index = current.waiting.indexOf(waiter);
        if (index < 0) return;
        current.waiting.splice(index, 1);
        signal?.removeEventListener('abort', waiter.abort!);
        reject(signal?.reason ?? new Error('模型排队已取消'));
        this.drain(key, current);
      };
      current.waiting.push(waiter);
      signal?.addEventListener('abort', waiter.abort, {once:true});
      if (signal?.aborted) waiter.abort();
      else this.drain(key, current);
    });
  }
  private drain(key: string, pool: Pool) {
    while (pool.active < this.capacity && pool.waiting.length) pool.waiting.shift()!.grant();
    if (!pool.active && !pool.waiting.length) this.pools.delete(key);
  }
  async run<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>, onState?: (state: ModelAdmissionState) => void): Promise<T> {
    const notify = (state: ModelAdmissionState) => { try { onState?.(state); } catch { /* Status reporting must never leak a slot. */ } };
    let release: (() => void) | undefined;
    try {
      signal?.throwIfAborted();
      if (this.snapshot(key).active >= this.capacity) notify('waiting');
      release = await this.acquire(key, signal);
      signal?.throwIfAborted(); notify('active');
      return await operation();
    } finally { release?.(); notify('released'); }
  }
}

// Different model names/protocols using the same origin and credential share a pool.
// A per-process HMAC prevents credentials from appearing in keys or diagnostics.
const salt = randomBytes(32);
export function modelResourceKey(connection: {baseUrl: string; apiKey?: string}): string {
  return createHmac('sha256', salt).update(JSON.stringify([new URL(connection.baseUrl).origin, connection.apiKey || ''])).digest('hex');
}
export const modelScheduler = new ModelScheduler();
