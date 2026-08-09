import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { findBlenderExecutable, threeDimensionalVerificationCheck, verifyThreeDimensionalArtifact } from "../../examples/companion/three-dimensional-verifier.js";
import { assessProfessionalArtifact } from "../../examples/companion/professional-artifact-gate.js";

test("三维产物只有通过真实 Blender 打开和场景健康检查后才算核验", { skip: !findBlenderExecutable() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-blender-verify-"));
  try {
    const blender = findBlenderExecutable()!;
    const file = join(dir, "cube.blend");
    const code = `import bpy;bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.mesh.primitive_cube_add(size=2);bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(file)})`;
    const created = spawnSync(blender, ["--background", "--factory-startup", "--python-expr", code], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(created.status, 0);
    const receipt = verifyThreeDimensionalArtifact(file);
    assert.equal(receipt.passed, true);
    assert.equal(receipt.meshCount, 1);
    assert.deepEqual(receipt.dimensions.map(Math.round), [2, 2, 2]);
    assert.match(receipt.fileHash, /^[a-f0-9]{64}$/);
    const gate = assessProfessionalArtifact({
      domain: "three-dimensional",
      artifactExists: true,
      structuredInput: true,
      intermediateArtifact: true,
      renderedArtifact: true,
      version: receipt.fileHash,
      checks: [threeDimensionalVerificationCheck(receipt)],
    });
    assert.equal(gate.level, "verified");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("缺失或错误格式不能凭文件名升级为三维核验通过", () => {
  const receipt = verifyThreeDimensionalArtifact(join(tmpdir(), "missing.blend"));
  assert.equal(receipt.passed, false);
  assert.match(receipt.detail, /不存在|无法/);
});
