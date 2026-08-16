import { createHash } from "node:crypto";
import { extname } from "node:path";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
import { listDevelopmentWorkspace, readDevelopmentWorkspaceFile } from "./development-workspace.js";

export interface DevelopmentCodeMapEntry {
  path: string;
  language: string;
  symbols: string[];
  dependencies: string[];
  exports: string[];
  localDependencies: string[];
}

export interface DevelopmentCodeMap {
  version: 1;
  fileCount: number;
  analyzedFileCount: number;
  entries: DevelopmentCodeMapEntry[];
  fingerprint: string;
}

const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".svelte", ".swift", ".ts", ".tsx", ".vue"]);
const MAX_ANALYZED_FILES = 48;
const MAX_SOURCE_CHARS = 80_000;

export function buildDevelopmentCodeMap(workspacePath: string): DevelopmentCodeMap {
  const listing = listDevelopmentWorkspace(workspacePath);
  const candidates = listing.files
    .filter((file) => file.readable && SOURCE_EXTENSIONS.has(extname(file.path).toLowerCase()))
    .sort((left, right) => sourcePriority(left.path) - sourcePriority(right.path) || left.path.localeCompare(right.path))
    .slice(0, MAX_ANALYZED_FILES);
  const entries = candidates.flatMap((file) => {
    try {
      const source = readDevelopmentWorkspaceFile(workspacePath, file.path).content.slice(0, MAX_SOURCE_CHARS);
      return [analyzeSource(file.path, source)];
    } catch {
      return [];
    }
  });
  const stable = JSON.stringify(entries);
  return {
    version: 1,
    fileCount: listing.files.length,
    analyzedFileCount: entries.length,
    entries,
    fingerprint: createHash("sha256").update(stable).digest("hex"),
  };
}

export function renderDevelopmentCodeMap(map: DevelopmentCodeMap): string {
  if (!map.entries.length) return "当前项目没有可分析的源代码文件。";
  const rows = map.entries.map((entry) => {
    const symbols = entry.symbols.length ? `；关键符号：${entry.symbols.join("、")}` : "";
    const dependencies = entry.dependencies.length ? `；依赖：${entry.dependencies.join("、")}` : "";
    const links = entry.localDependencies.length ? `；项目内关联：${entry.localDependencies.join("、")}` : "";
    return `- ${entry.path}（${entry.language}）${symbols}${dependencies}${links}`;
  });
  return [
    `共发现 ${map.fileCount} 个可见文件，分析 ${map.analyzedFileCount} 个主要源文件。`,
    "这份地图用于定位入口、模块与关键符号；执行前仍应重新读取目标文件。",
    ...rows,
  ].join("\n");
}

function analyzeSource(path: string, source: string): DevelopmentCodeMapEntry {
  const extension = extname(path).toLowerCase();
  const language = languageName(extension);
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extension)) return analyzeTypeScriptSource(path, source, language, extension);
  const symbols = uniqueMatches(source, symbolPatterns(extension), 8);
  const dependencies = uniqueMatches(source, dependencyPatterns(extension), 6);
  return { path, language, symbols, dependencies, exports: [], localDependencies: dependencies.filter((item) => item.startsWith(".")) };
}

export function selectRelevantCodeMapFiles(map: DevelopmentCodeMap, instruction: string, excluded: string[] = [], limit = 6): string[] {
  const ignored = new Set(excluded);
  const terms = searchTerms(instruction);
  return map.entries
    .filter((entry) => !ignored.has(entry.path))
    .map((entry) => ({ path: entry.path, score: relevanceScore(entry, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(0, Math.min(12, limit)))
    .map((entry) => entry.path);
}

function analyzeTypeScriptSource(path: string, source: string, language: string, extension: string): DevelopmentCodeMapEntry {
  const scanner = createScanner(true, extension === ".tsx" || extension === ".jsx" ? LanguageVariant.JSX : LanguageVariant.Standard, source);
  const tokens: Array<{ kind: SyntaxKind; value: string }> = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({ kind, value: scanner.getTokenValue() || scanner.getTokenText() });
  }
  const symbols: string[] = [];
  const exports: string[] = [];
  const dependencies: string[] = [];
  const add = (target: string[], value: string | undefined, limit: number) => {
    if (value && !target.includes(value) && target.length < limit) target.push(value);
  };
  let exported = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === SyntaxKind.ExportKeyword) {
      exported = true;
      continue;
    }
    if (token.kind === SyntaxKind.ImportKeyword || (exported && token.kind === SyntaxKind.FromKeyword)) {
      const dependency = findModuleSpecifier(tokens, index);
      add(dependencies, dependency, 8);
    }
    if (DECLARATION_TOKENS.has(token.kind)) {
      const name = nextIdentifier(tokens, index + 1);
      add(symbols, name, 10);
      if (exported) add(exports, name, 10);
      exported = false;
      continue;
    }
    if (token.kind === SyntaxKind.SemicolonToken || token.kind === SyntaxKind.CloseBraceToken) {
      exported = false;
    }
  }
  return { path, language, symbols, dependencies, exports, localDependencies: dependencies.filter((item) => item.startsWith(".")) };
}

const DECLARATION_TOKENS = new Set<SyntaxKind>([
  SyntaxKind.FunctionKeyword,
  SyntaxKind.ClassKeyword,
  SyntaxKind.InterfaceKeyword,
  SyntaxKind.TypeKeyword,
  SyntaxKind.EnumKeyword,
  SyntaxKind.ConstKeyword,
  SyntaxKind.LetKeyword,
  SyntaxKind.VarKeyword,
]);

function nextIdentifier(tokens: Array<{ kind: SyntaxKind; value: string }>, start: number): string | undefined {
  return tokens.slice(start, start + 4).find((token) => token.kind === SyntaxKind.Identifier)?.value;
}

function findModuleSpecifier(tokens: Array<{ kind: SyntaxKind; value: string }>, start: number): string | undefined {
  for (let index = start + 1; index < Math.min(tokens.length, start + 40); index += 1) {
    const token = tokens[index]!;
    if (token.kind === SyntaxKind.StringLiteral) return token.value;
    if (token.kind === SyntaxKind.SemicolonToken) return undefined;
  }
  return undefined;
}

function searchTerms(value: string): string[] {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9_$-]{2,}|[\u3400-\u9fff]{2,}/g) || [])].slice(0, 40);
}

function relevanceScore(entry: DevelopmentCodeMapEntry, terms: string[]): number {
  const path = entry.path.toLowerCase();
  const name = path.split("/").pop() || path;
  const symbols = `${entry.symbols.join(" ")} ${entry.exports.join(" ")}`.toLowerCase();
  let score = /(^|\/)(index|main|app|server|cli)\.[^.]+$/.test(path) ? 2 : 0;
  for (const term of terms) {
    if (name.includes(term)) score += 8;
    else if (path.includes(term)) score += 5;
    if (symbols.includes(term)) score += 6;
  }
  return score;
}

function uniqueMatches(source: string, patterns: RegExp[], limit: number): string[] {
  const values: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = String(match[1] || match[2] || "").trim();
      if (value && !values.includes(value)) values.push(value);
      if (values.length >= limit) return values;
    }
  }
  return values;
}

function symbolPatterns(extension: string): RegExp[] {
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extension)) {
    return [
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      /(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
      /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    ];
  }
  if (extension === ".py") return [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, /^class\s+([A-Za-z_]\w*)/gm];
  if (extension === ".go") return [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, /^type\s+([A-Za-z_]\w*)/gm];
  if (extension === ".rs") return [/(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/g, /(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g];
  return [/(?:class|interface|struct|enum|func|function)\s+([A-Za-z_$][\w$]*)/g];
}

function dependencyPatterns(extension: string): RegExp[] {
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extension)) return [/from\s+["']([^"']+)["']/g, /require\(["']([^"']+)["']\)/g];
  if (extension === ".py") return [/^from\s+([\w.]+)\s+import/gm, /^import\s+([\w.]+)/gm];
  if (extension === ".go") return [/^\s*["`]([^"`]+)["`]\s*$/gm];
  if (extension === ".rs") return [/^use\s+([^;]+);/gm, /^mod\s+([A-Za-z_]\w*)/gm];
  return [];
}

function languageName(extension: string): string {
  return ({
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".swift": "Swift",
    ".c": "C", ".cc": "C++", ".cpp": "C++", ".cs": "C#", ".rb": "Ruby", ".php": "PHP",
    ".vue": "Vue", ".svelte": "Svelte",
  } as Record<string, string>)[extension] || extension.slice(1).toUpperCase();
}

function sourcePriority(path: string): number {
  const normalized = path.toLowerCase();
  const name = normalized.split("/").pop() || normalized;
  const depth = normalized.split("/").length;
  if (/^(index|main|app|server|cli)\.[^.]+$/.test(name)) return depth;
  if (/(^|\/)(src|app|server|lib)\//.test(normalized)) return 20 + depth;
  if (/(test|spec|fixture|generated)/.test(normalized)) return 100 + depth;
  return 50 + depth;
}
