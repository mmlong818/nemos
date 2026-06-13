// utils/export.ts — 导出当前 user 全部 memory 为 json-ld / markdown
//
// 从 user-memory.ts 抽出，控行数 budget；逻辑与 v0.3 一致。

import { SCHEMA_VERSION, type Layer, type Memory } from "../types.js";
import { nowIso } from "./id.js";

export function exportMarkdown(all: Memory[]): string {
  return all
    .map((m) => {
      const fm = JSON.stringify(
        {
          id: m.id,
          layer: m.layer,
          type: m.type,
          scope: m.scope,
          source: m.source,
          created_at: m.created_at,
          archival_ref: m.archival_ref,
        },
        null,
        2,
      );
      return `---\n${fm}\n---\n\n${m.content}\n`;
    })
    .join("\n\n");
}

export function exportJsonLd(all: Memory[], tenantId: string, userId: string): string {
  const byLayer: Record<Layer, Memory[]> = {
    archival: [],
    episodic: [],
    semantic: [],
    personal_semantic: [],
    procedural: [],
  };
  for (const m of all) byLayer[m.layer].push(m);
  return JSON.stringify(
    {
      "@context": "https://mnemos.org/schema/v1",
      "@type": "PersonalMemoryArchive",
      mnemos_schema_version: SCHEMA_VERSION,
      export_version: "1.0",
      exported_at: nowIso(),
      tenant_id: tenantId,
      user_id: userId,
      stores: byLayer,
    },
    null,
    2,
  );
}
