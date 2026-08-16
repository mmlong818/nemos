import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildDevelopmentContextBundle,
  developmentContextSummary,
  normalizeDevelopmentContextSelection,
  renderDevelopmentContextBundle,
} from "../../examples/companion/development-context.js";

test("开发上下文包只收录明确选择的安全文件并生成可核对摘要", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-context-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "export function hello() { return '你好'; }\n", "utf8");
    writeFileSync(join(root, ".env"), "API_KEY=secret", "utf8");
    const bundle = buildDevelopmentContextBundle({
      workspacePath: root,
      instruction: "修复问候函数并验证",
      selection: { selectedPaths: ["src/index.ts", ".env"], includeGitDiff: false },
      decisions: ["保持现有函数名"],
    });

    assert.deepEqual(bundle.selectedPaths, ["src/index.ts"]);
    assert.equal(bundle.includeGitDiff, false);
    assert.ok(bundle.items.some((item) => item.kind === "instruction"));
    assert.ok(bundle.items.some((item) => item.kind === "code_map"));
    assert.ok(bundle.items.some((item) => item.kind === "decision"));
    assert.ok(!renderDevelopmentContextBundle(bundle).includes("API_KEY=secret"));
    assert.equal(developmentContextSummary(bundle).itemCount, bundle.items.length);
    assert.equal(developmentContextSummary(bundle).codeMapFiles, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("开发上下文选择去重、限制数量并保持 Git 差异开关", () => {
  const selectedPaths = Array.from({ length: 20 }, (_, index) => `src/${index}.ts`);
  const normalized = normalizeDevelopmentContextSelection({
    selectedPaths: [selectedPaths[0], ...selectedPaths],
    includeGitDiff: false,
  });
  assert.equal(normalized.selectedPaths.length, 12);
  assert.equal(normalized.selectedPaths[0], "src/0.ts");
  assert.equal(normalized.includeGitDiff, false);
  assert.equal(normalized.autoSelect, true);
});

test("开发上下文会按目标自动加入相关代码，也允许明确关闭", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-auto-context-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "auth.ts"), "export function verifyLogin() { return true; }\n", "utf8");
    writeFileSync(join(root, "src", "unrelated.ts"), "export const color = 'red';\n", "utf8");
    const automatic = buildDevelopmentContextBundle({
      workspacePath: root,
      instruction: "fix verifyLogin authentication",
      selection: { includeGitDiff: false, autoSelect: true },
    });
    assert.deepEqual(automatic.autoSelectedPaths, ["src/auth.ts"]);
    assert.ok(renderDevelopmentContextBundle(automatic).includes("verifyLogin"));
    const disabled = buildDevelopmentContextBundle({
      workspacePath: root,
      instruction: "fix verifyLogin authentication",
      selection: { includeGitDiff: false, autoSelect: false },
    });
    assert.deepEqual(disabled.autoSelectedPaths, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("开发页把上下文管理收在输入框内，并把选择随任务提交", () => {
  const companion = join(process.cwd(), "examples", "companion");
  const html = readFileSync(join(companion, "web", "develop.html"), "utf8");
  const script = readFileSync(join(companion, "web", "assets", "develop-center.js"), "utf8");
  assert.match(html, /id="developmentContextToggle"/);
  assert.match(html, /id="developmentContextDialog"/);
  assert.match(html, /id="developmentContextDiff"/);
  assert.match(html, /id="developmentContextAuto"/);
  assert.match(html, /id="developmentCodeMapState"/);
  assert.match(html, /id="developmentCompareDialog"/);
  assert.match(script, /contextSelection,/);
  assert.match(script, /payload\.contextBundle/);
  assert.match(script, /data\?\.runEvent/);
  assert.match(script, /developmentComparison/);
  assert.match(script, /renderDevelopmentRunComparison/);
  assert.match(script, /developmentDecisionGraph/);
});
