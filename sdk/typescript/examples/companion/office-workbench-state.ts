import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface OfficeWorkbenchSnapshot {
  revision: number;
  documents: unknown[];
  trash: unknown[];
  selectedId: string | null;
  updatedAt: string;
}

export class OfficeWorkbenchRevisionConflict extends Error {
  constructor(readonly current: OfficeWorkbenchSnapshot) {
    super("文件工作台已在其他窗口更新，请先重新载入");
  }
}

const EMPTY_STATE: OfficeWorkbenchSnapshot = {
  revision: 0,
  documents: [],
  trash: [],
  selectedId: null,
  updatedAt: "",
};

export class OfficeWorkbenchStateStore {
  private state: OfficeWorkbenchSnapshot;

  constructor(private readonly file: string) {
    this.state = this.load();
  }

  read(): OfficeWorkbenchSnapshot {
    return structuredClone(this.state);
  }

  save(input: { expectedRevision: number; documents: unknown[]; trash: unknown[]; selectedId?: string | null }): OfficeWorkbenchSnapshot {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== this.state.revision) {
      throw new OfficeWorkbenchRevisionConflict(this.read());
    }
    if (!Array.isArray(input.documents) || !Array.isArray(input.trash)) throw new Error("文件工作台数据无效");
    const candidate: OfficeWorkbenchSnapshot = {
      revision: this.state.revision + 1,
      documents: input.documents.slice(0, 80),
      trash: input.trash.slice(0, 100),
      selectedId: typeof input.selectedId === "string" ? input.selectedId.slice(0, 120) : null,
      updatedAt: new Date().toISOString(),
    };
    const encoded = JSON.stringify(candidate);
    if (Buffer.byteLength(encoded, "utf8") > 6 * 1024 * 1024) throw new Error("文件工作台内容过大，请先导出或清理旧文件");
    writeAtomic(this.file, encoded);
    this.state = candidate;
    return this.read();
  }

  private load(): OfficeWorkbenchSnapshot {
    if (!existsSync(this.file)) return structuredClone(EMPTY_STATE);
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as Partial<OfficeWorkbenchSnapshot>;
      if (!Number.isInteger(value.revision) || !Array.isArray(value.documents) || !Array.isArray(value.trash)) return structuredClone(EMPTY_STATE);
      return {
        revision: Number(value.revision),
        documents: value.documents.slice(0, 80),
        trash: value.trash.slice(0, 100),
        selectedId: typeof value.selectedId === "string" ? value.selectedId : null,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
      };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }
}

function writeAtomic(file: string, value: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, file);
}
