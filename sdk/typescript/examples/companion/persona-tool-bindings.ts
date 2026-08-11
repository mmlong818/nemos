// persona-tool-bindings.ts — v0.8 每角色独立工具集
//
// 之前后台工具是一个全局池，所有角色共享。这里让每个角色各自持有工具集：
// 研究角色可以只有来源类工具，写作角色可以完全没有联网能力。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import type { PersonaToolBinding } from "./capability-tools.js";

export type { PersonaToolBinding } from "./capability-tools.js";

interface StoredBinding extends PersonaToolBinding {
  personaId: string;
  updatedAt: string;
}

function cleanEntries(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const cleaned = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

export class PersonaToolBindings {
  private readonly file: string;
  private bindings: StoredBinding[];

  constructor(dataDir: string) {
    this.file = join(dataDir, "persona-tool-bindings.json");
    this.bindings = this.load();
  }

  private load(): StoredBinding[] {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as StoredBinding[]) : [];
    } catch {
      // 读不出来时按「没有绑定」处理——也就是不限制，与升级前的行为一致。
      // 这里刻意不改成「全部禁用」：配置损坏不该让所有角色突然失去工具。
      return [];
    }
  }

  private save(): void {
    writeAtomic(this.file, JSON.stringify(this.bindings, null, 2));
  }

  list(): StoredBinding[] {
    return this.bindings.map((item) => structuredClone(item));
  }

  /**
   * 没有限制时返回 undefined。
   *
   * 「没配过」和「配了但两个列表都空」含义相同，都收敛成 undefined，
   * 免得调用方还要分辨 {} 和 undefined 有没有区别。
   */
  get(personaId: string): PersonaToolBinding | undefined {
    const found = this.bindings.find((item) => item.personaId === personaId.trim());
    if (!found) return undefined;
    const binding: PersonaToolBinding = {};
    if (found.allow?.length) binding.allow = [...found.allow];
    if (found.deny?.length) binding.deny = [...found.deny];
    return binding.allow || binding.deny ? binding : undefined;
  }

  set(personaId: string, binding: PersonaToolBinding): StoredBinding {
    const key = personaId.trim();
    if (!key) throw new Error("工具绑定需要一个角色 id。");
    const next: StoredBinding = {
      personaId: key,
      allow: cleanEntries(binding.allow),
      deny: cleanEntries(binding.deny),
      updatedAt: new Date().toISOString(),
    };
    const index = this.bindings.findIndex((item) => item.personaId === key);
    if (index >= 0) this.bindings[index] = next;
    else this.bindings.push(next);
    this.save();
    return structuredClone(next);
  }

  clear(personaId: string): boolean {
    const index = this.bindings.findIndex((item) => item.personaId === personaId.trim());
    if (index < 0) return false;
    this.bindings.splice(index, 1);
    this.save();
    return true;
  }
}
