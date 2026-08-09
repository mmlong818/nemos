import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { KnowledgeLibrary } from "../../examples/companion/knowledge-library.js";

test("资料可以保存、归档、恢复并限制链接协议", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-knowledge-"));
  try {
    const library = new KnowledgeLibrary(dir);
    const item = library.create({ title: "访谈记录", content: "用户希望减少重复录入。" });
    assert.equal(library.list().length, 1);
    assert.equal(library.get(item.id)?.content, "用户希望减少重复录入。");
    library.archive(item.id);
    assert.equal(library.list().length, 0);
    assert.equal(library.list(true)[0]?.archivedAt !== undefined, true);
    library.restore(item.id);
    assert.equal(library.list().length, 1);
    assert.throws(() => library.create({ title: "危险链接", sourceUrl: "file:///etc/passwd" }), /http/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("任务只注入明确选择的资料", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-knowledge-context-"));
  const prompts: string[] = [];
  try {
    const library = new KnowledgeLibrary(dir);
    const selected = library.create({ title: "项目边界", content: "首版只支持本地运行。" });
    library.create({ title: "无关资料", content: "这段内容不应进入任务。" });
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      knowledgeContext: (ids) => library.buildPromptBlock(ids),
      notify: async (_personaId, prompt) => {
        prompts.push(prompt);
        return { reply: "任务结果\n\n交付完成。", facts: [] };
      },
    });
    const task = runtime.createTask({
      title: "整理范围",
      personaId: "clownfish",
      capabilityId: "document-draft",
      instruction: "整理产品范围",
      knowledgeIds: [selected.id],
    });
    await runtime.runTask(task.id, "test");
    assert.match(prompts[0], /首版只支持本地运行/);
    assert.doesNotMatch(prompts[0], /这段内容不应进入任务/);
    assert.deepEqual(runtime.snapshot().tasks.find((item) => item.id === task.id)?.knowledgeIds, [selected.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
