/**
 * DOCX 保真回归的编辑步骤。
 *
 * 对目录里的每个 .docx 改动一个段落，写出产物，并打印一份供 Word 端核对的清单。
 * 由 scripts/docx-fidelity/Test-DocxFidelity.ps1 驱动，不参与单元测试
 * （单元测试不能依赖本机装了 Word）。
 *
 * 用法（工作目录须为 sdk/typescript）：
 *   npx tsx scripts/docx-fidelity-cli.ts <输入目录> <输出目录>
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { applyDocxTextEdits, readDocxText } from "../examples/companion/office-docx-text-edit.js";
import { validateOfficeFile } from "../examples/companion/office-validation.js";

interface CaseReport {
  file: string;
  output: string;
  editedDocxIndex: number;
  editedOrdinal: number;
  originalText: string;
  newText: string;
  changed: number[];
  skipped: number[];
  structureChecksPassed: boolean;
  structureFailures: string[];
  error?: string;
}

async function run(inputDirectory: string, outputDirectory: string): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  const files = readdirSync(inputDirectory).filter((name) => extname(name).toLowerCase() === ".docx");
  const reports: CaseReport[] = [];

  for (const name of files) {
    const source = readFileSync(join(inputDirectory, name));
    const output = join(outputDirectory, `${basename(name, ".docx")}.edited.docx`);
    try {
      const blocks = await readDocxText(source);
      const ordinal = blocks.findIndex((block) => block.textEditable && block.text.trim().length > 0);
      if (ordinal < 0) throw new Error("没有可改文字的段落");
      const target = blocks[ordinal]!;
      // 改前缀而不是整段替换：这样能同时检验补丁只重写差异部分。
      const newText = `已改写：${target.text}`;
      const result = await applyDocxTextEdits(source, [{ docxIndex: target.docxIndex, text: newText }]);
      const receipt = await validateOfficeFile("docx", result.data);
      writeFileSync(output, result.data);
      reports.push({
        file: name,
        output,
        editedDocxIndex: target.docxIndex,
        editedOrdinal: ordinal,
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
        editedDocxIndex: -1,
        editedOrdinal: -1,
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
  process.stderr.write("用法：npx tsx scripts/docx-fidelity-cli.ts <输入目录> <输出目录>\n");
  process.exit(2);
}
void run(input, output).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
