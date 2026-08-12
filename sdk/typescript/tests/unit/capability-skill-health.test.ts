import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

test("能力文件被外部改动后停止执行并允许从历史版本恢复", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-health-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "完成", facts: [] }),
    });
    const ability = runtime.learnFromWork({ personaId: "clownfish", name: "周报整理", description: "整理周报", goal: "整理本周进展", learnedKey: "weekly" });
    runtime.learnFromWork({ personaId: "clownfish", name: "周报整理", description: "整理项目周报", goal: "整理进展与风险", learnedKey: "weekly" });
    const skill = runtime.auditSkills().items.find((item) => item.abilityId === ability.id)!;
    writeFileSync(skill.skillFile, `${readFileSync(skill.skillFile, "utf8")}\n未经登记的改动`, "utf8");

    const damaged = runtime.auditSkills().items.find((item) => item.abilityId === ability.id)!;
    assert.equal(damaged.integrityValid, false);
    assert.equal(damaged.state, "stale");
    assert.equal(damaged.canRollback, true);
    assert.throws(() => runtime.createTask({ title: "周报", personaId: "clownfish", capabilityId: ability.id, instruction: "生成周报" }), /能力文件检查未通过/);

    runtime.rollbackAbilityVersion(ability.id);
    const restored = runtime.auditSkills().items.find((item) => item.abilityId === ability.id)!;
    assert.equal(restored.integrityValid, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
