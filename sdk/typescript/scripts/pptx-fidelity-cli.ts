/**
 * PPTX 保真回归的编辑步骤。
 *
 * 对目录里的每个 .pptx 改动一个段落，写出产物，并打印一份供 PowerPoint 端
 * 核对的清单。由 scripts/pptx-fidelity/Test-PptxFidelity.ps1 驱动，
 * 不参与单元测试（单元测试不能依赖本机装了 PowerPoint）。
 *
 * 用法（工作目录须为 sdk/typescript）：
 *   npx tsx scripts/pptx-fidelity-cli.ts <输入目录> <输出目录>
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { applyPptxTextEdits, readPptxText } from "../examples/companion/office-pptx-text-edit.js";
import { validateOfficeFile } from "../examples/companion/office-validation.js";

interface CaseReport {
  file: string;
  output: string;
  editedKey: string;
  editedSlide: number;
  originalText: string;
  newText: string;
  changed: string[];
  skipped: string[];
  structureChecksPassed: boolean;
  structureFailures: string[];
  error?: string;
}

async function run(inputDirectory: string, outputDirectory: string): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  const files = readdirSync(inputDirectory).filter((name) => extname(name).toLowerCase() === ".pptx");
  const reports: CaseReport[] = [];

  for (const name of files) {
    const source = readFileSync(join(inputDirectory, name));
    const output = join(outputDirectory, `${basename(name, ".pptx")}.edited.pptx`);
    try {
      const blocks = await readPptxText(source);
      const target = blocks.find((block) => block.textEditable && block.text.trim().length > 0);
      if (!target) throw new Error("没有可改文字的段落");
      // 只在段落开头插入：改动落在第一个 run 内，因此不应触发跨格式拒绝。
      const newText = `已改写：${target.text}`;
      const result = await applyPptxTextEdits(source, [{
        slideIndex: target.slideIndex,
        elementIndex: target.elementIndex,
        paragraphIndex: target.paragraphIndex,
        text: newText,
      }]);
      const receipt = await validateOfficeFile("pptx", result.data);
      writeFileSync(output, result.data);
      reports.push({
        file: name,
        output,
        editedKey: `${target.slideIndex}:${target.elementIndex}:${target.paragraphIndex}`,
        editedSlide: target.slideIndex + 1,
        originalText: target.text,
        newText,
        changed: result.changed,
        skipped: result.skipped,
        structureChecksPassed: receipt.passed,
        structureFailures: receipt.checks.filter((check) => !check.passed).map((check) => check.name),
      });
    } catch (error) {
      reports.push({
        file: name,
        output,
        editedKey: "",
        editedSlide: 0,
        originalText: "",
        newText: "",
        changed: [],
        skipped: [],
        structureChecksPassed: false,
        structureFailures: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  process.stdout.write(JSON.stringify(reports, null, 2));
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stderr.write("用法：npx tsx scripts/pptx-fidelity-cli.ts <输入目录> <输出目录>\n");
  process.exit(2);
}
void run(input, output).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
