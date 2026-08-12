import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DevelopmentProposalStore } from "./development-proposals.js";
import { detectDevelopmentChecks, runDevelopmentCheck, type DevelopmentCheckReceipt } from "./pi-development.js";

interface DevelopmentCorpusCase {
  id: string;
  stack: string;
  files: Record<string, string>;
  checks: string[];
}

export interface DevelopmentCorpusReceipt {
  id: string;
  stack: string;
  passed: boolean;
  detectedChecks: string[];
  checks: DevelopmentCheckReceipt[];
  proposal: { applied: boolean; rolledBack: boolean };
}

export const DEVELOPMENT_CORPUS: DevelopmentCorpusCase[] = [
  nodeCase("node-cjs", "Node.js CommonJS", { test: "node test.cjs" }, { "app.cjs": "module.exports = (a, b) => a + b;", "test.cjs": "const assert=require('node:assert');assert.equal(require('./app.cjs')(2,3),5);" }, ["npm_test"]),
  nodeCase("node-esm", "Node.js ESM", { test: "node test.mjs", build: "node --check app.mjs" }, { "app.mjs": "export const twice = value => value * 2;", "test.mjs": "import assert from 'node:assert/strict';import {twice} from './app.mjs';assert.equal(twice(4),8);" }, ["npm_test", "npm_build"]),
  nodeCase("typescript-contract", "TypeScript 合同检查", { typecheck: "node verify.cjs" }, { "types.ts": "export interface Task { id: string; done: boolean }", "verify.cjs": "const fs=require('node:fs');const value=fs.readFileSync('types.ts','utf8');if(!value.includes('done: boolean'))process.exit(1);" }, ["npm_typecheck"]),
  nodeCase("static-web", "静态网页", { test: "node verify.cjs" }, { "index.html": "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>示例</title><main>可用页面</main></html>", "verify.cjs": "const fs=require('node:fs');const value=fs.readFileSync('index.html','utf8');if(!value.includes('<main>'))process.exit(1);" }, ["npm_test"]),
  nodeCase("node-cli", "Node.js CLI", { check: "node cli.cjs --self-test" }, { "cli.cjs": "if(process.argv[2]==='--self-test'){process.stdout.write('ok');}else{process.exit(2);}" }, ["npm_check"]),
  pythonCase("python-module", "Python 模块", { "mathbox.py": "def add(a, b):\n    return a + b\n", "tests/test_mathbox.py": "import unittest\nfrom mathbox import add\nclass MathboxTest(unittest.TestCase):\n    def test_add(self): self.assertEqual(add(2, 3), 5)\n" }),
  pythonCase("python-cli", "Python CLI", { "cli.py": "def normalize(value):\n    return value.strip().lower()\n", "tests/test_cli.py": "import unittest\nfrom cli import normalize\nclass CliTest(unittest.TestCase):\n    def test_normalize(self): self.assertEqual(normalize(' OK '), 'ok')\n" }),
  nodeCase("json-service", "JSON 配置服务", { test: "node verify.cjs" }, { "config.json": "{\"port\":8787,\"localOnly\":true}", "verify.cjs": "const c=require('./config.json');if(c.port!==8787||!c.localOnly)process.exit(1);" }, ["npm_test"]),
  nodeCase("browser-library", "浏览器组件库", { build: "node build.cjs", test: "node test.cjs" }, { "component.js": "export function label(value){return String(value).trim()}", "build.cjs": "const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.copyFileSync('component.js','dist/component.js');", "test.cjs": "const fs=require('node:fs');const value=fs.readFileSync('component.js','utf8');if(!value.includes('trim'))process.exit(1);" }, ["npm_build", "npm_test"]),
  nodeCase("workspace-tool", "本地工作区工具", { lint: "node lint.cjs", test: "node test.cjs" }, { "workspace.cjs": "exports.safe=name=>!name.includes('..');", "lint.cjs": "const fs=require('node:fs');if(fs.readFileSync('workspace.cjs','utf8').includes('eval('))process.exit(1);", "test.cjs": "const assert=require('node:assert');const x=require('./workspace.cjs');assert.equal(x.safe('../x'),false);" }, ["npm_lint", "npm_test"]),
];

export async function runDevelopmentCorpusRegression(root: string): Promise<DevelopmentCorpusReceipt[]> {
  mkdirSync(root, { recursive: true });
  const receipts: DevelopmentCorpusReceipt[] = [];
  for (const item of DEVELOPMENT_CORPUS) {
    const workspace = join(root, item.id);
    mkdirSync(workspace, { recursive: true });
    for (const [path, content] of Object.entries(item.files)) {
      const target = join(workspace, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
    writeFileSync(join(workspace, "README.md"), `# ${item.stack}\n\n初始内容。\n`, "utf8");
    const detectedChecks = detectDevelopmentChecks(workspace, "develop");
    const checks: DevelopmentCheckReceipt[] = [];
    for (const check of item.checks) checks.push(await runDevelopmentCheck(workspace, check));
    const proposalStore = new DevelopmentProposalStore(join(root, ".proposals", item.id));
    const session = proposalStore.begin(workspace);
    session.write(join(workspace, "README.md"), `# ${item.stack}\n\n已通过开发工作台修改。\n`);
    const pending = session.finalize();
    const applied = proposalStore.apply(pending.id);
    const appliedOk = applied.state === "applied" && readFileSync(join(workspace, "README.md"), "utf8").includes("已通过开发工作台修改");
    const rolledBack = proposalStore.rollback(pending.id);
    const rolledBackOk = rolledBack.state === "rolled_back" && readFileSync(join(workspace, "README.md"), "utf8").includes("初始内容");
    receipts.push({
      id: item.id,
      stack: item.stack,
      passed: item.checks.every((check) => detectedChecks.includes(check)) && checks.every((check) => check.passed) && appliedOk && rolledBackOk,
      detectedChecks,
      checks,
      proposal: { applied: appliedOk, rolledBack: rolledBackOk },
    });
  }
  return receipts;
}

function nodeCase(id: string, stack: string, scripts: Record<string, string>, files: Record<string, string>, checks: string[]): DevelopmentCorpusCase {
  return { id, stack, files: { "package.json": JSON.stringify({ private: true, scripts }, null, 2), ...files }, checks };
}

function pythonCase(id: string, stack: string, files: Record<string, string>): DevelopmentCorpusCase {
  return { id, stack, files: { "pyproject.toml": "[project]\nname = \"fixture\"\nversion = \"0.0.0\"\n", ...files }, checks: ["python_compile", "python_unittest"] };
}
