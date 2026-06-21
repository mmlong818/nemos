// storage.ts — top-level shim, 全部实现在 src/storage/ 子目录
//
// 保留此文件是为了让外部 `import { ... } from "./storage.js"`（包括 tests
// 通过 `../../../src/storage.js`）继续工作；真实实现已拆到 storage/ 子目录。

export type { Storage, IngestQueueRow, SearchFilter } from "./storage/index.js";
export { SqliteStorage, InMemoryStorage, makeStorage } from "./storage/index.js";
