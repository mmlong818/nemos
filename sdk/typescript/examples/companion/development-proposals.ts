import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type DevelopmentProposalState =
  | "staging"
  | "pending"
  | "applied"
  | "rejected"
  | "conflicted"
  | "failed"
  | "rolled_back";

export interface DevelopmentProposalFile {
  path: string;
  operation: "create" | "update";
  baseHash?: string;
  proposedHash: string;
  byteLength: number;
  baseContentBase64?: string;
  proposedContentBase64: string;
}

export interface DevelopmentProposal {
  id: string;
  workspacePath: string;
  state: DevelopmentProposalState;
  createdAt: string;
  updatedAt: string;
  baseRevision?: string;
  files: DevelopmentProposalFile[];
  appliedPaths?: string[];
  conflicts?: string[];
  error?: string;
}

type StagedFile = {
  path: string;
  absolutePath: string;
  baseContent?: Buffer;
  proposedContent: Buffer;
};

const MAX_PROPOSAL_FILES = 100;
const MAX_PROPOSAL_BYTES = 5_000_000;

export class DevelopmentProposalSession {
  private readonly staged = new Map<string, StagedFile>();
  private closed = false;

  constructor(
    private readonly store: DevelopmentProposalStore,
    readonly proposal: DevelopmentProposal,
    private readonly stagingWorkspacePath = proposal.workspacePath,
  ) {}

  write(absolutePath: string, content: string): void {
    this.assertOpen();
    const path = workspaceRelativePath(this.stagingWorkspacePath, absolutePath);
    const previous = this.staged.get(path);
    if (!previous && this.staged.size >= MAX_PROPOSAL_FILES) {
      throw new Error(`单次开发提案最多修改 ${MAX_PROPOSAL_FILES} 个文件。`);
    }
    if (previous && !fileHasHash(absolutePath, digest(previous.proposedContent))) {
      throw new Error(`文件在开发执行期间发生了其他修改，已停止写入：${path}`);
    }

    const item: StagedFile = {
      path,
      absolutePath,
      baseContent: previous?.baseContent ?? readBaseContent(this.proposal.workspacePath, path),
      proposedContent: Buffer.from(content, "utf8"),
    };
    this.staged.set(path, item);
    try {
      this.assertSizeLimit();
    } catch (error) {
      if (previous) this.staged.set(path, previous);
      else this.staged.delete(path);
      throw error;
    }

    // 先持久化预期写入内容；即使进程随后中断，重启恢复也只会撤销完全匹配的能力写入。
    this.proposal.files = [...this.staged.values()].map(toProposalFile);
    this.store.persist(this.proposal);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, item.proposedContent);
  }

  finalize(): DevelopmentProposal {
    this.assertOpen();
    const conflicts = [...this.staged.values()]
      .filter((item) => !fileHasHash(item.absolutePath, digest(item.proposedContent)))
      .map((item) => item.path);
    if (conflicts.length) {
      this.closed = true;
      this.proposal.state = "conflicted";
      this.proposal.conflicts = conflicts;
      this.proposal.updatedAt = new Date().toISOString();
      this.store.persist(this.proposal);
      throw new Error(`文件在开发执行期间发生了其他修改，未自动覆盖：${conflicts.join("、")}`);
    }

    this.restoreOriginals();
    this.closed = true;
    this.proposal.files = [...this.staged.values()].map(toProposalFile);
    this.proposal.state = this.proposal.files.length ? "pending" : "applied";
    this.proposal.updatedAt = new Date().toISOString();
    this.store.persist(this.proposal);
    return structuredClone(this.proposal);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    const conflicts = this.restoreOriginals();
    this.closed = true;
    this.proposal.state = conflicts.length ? "conflicted" : "failed";
    this.proposal.conflicts = conflicts.length ? conflicts : undefined;
    this.proposal.error = error instanceof Error ? error.message : String(error);
    this.proposal.updatedAt = new Date().toISOString();
    this.store.persist(this.proposal);
  }

  private restoreOriginals(): string[] {
    const conflicts: string[] = [];
    for (const item of [...this.staged.values()].reverse()) {
      if (!fileHasHash(item.absolutePath, digest(item.proposedContent))) {
        conflicts.push(item.path);
        continue;
      }
      restoreFile(item.absolutePath, item.baseContent);
    }
    return conflicts.reverse();
  }

  private assertSizeLimit(): void {
    const bytes = [...this.staged.values()].reduce(
      (total, item) => total + item.proposedContent.byteLength + (item.baseContent?.byteLength ?? 0),
      0,
    );
    if (bytes > MAX_PROPOSAL_BYTES) {
      throw new Error("开发提案内容超过 5 MB，请缩小本次修改范围。");
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("开发提案已经结束。");
  }
}

export class DevelopmentProposalStore {
  private readonly file: string;
  private proposals: DevelopmentProposal[];

  constructor(dataDir: string, options: { recoverInterrupted?: boolean } = {}) {
    mkdirSync(dataDir, { recursive: true });
    this.file = resolve(dataDir, "development-proposals.json");
    this.proposals = readProposalFile(this.file);
    if (options.recoverInterrupted !== false) this.recoverInterrupted();
  }

  begin(workspacePath: string, baseRevision?: string, stagingWorkspacePath = workspacePath): DevelopmentProposalSession {
    const now = new Date().toISOString();
    const proposal: DevelopmentProposal = {
      id: `devprop_${randomUUID()}`,
      workspacePath,
      state: "staging",
      createdAt: now,
      updatedAt: now,
      baseRevision,
      files: [],
    };
    this.persist(proposal);
    return new DevelopmentProposalSession(this, proposal, stagingWorkspacePath);
  }

  get(id: string): DevelopmentProposal | undefined {
    const found = this.proposals.find((item) => item.id === id);
    return found ? structuredClone(found) : undefined;
  }

  list(): DevelopmentProposal[] {
    return structuredClone(this.proposals);
  }

  removeForWorkspace(workspacePath: string): number {
    const expected = resolve(workspacePath);
    const removed = this.proposals.filter((proposal) => resolve(proposal.workspacePath) === expected).length;
    if (!removed) return 0;
    this.proposals = this.proposals.filter((proposal) => resolve(proposal.workspacePath) !== expected);
    writeAtomic(this.file, Buffer.from(JSON.stringify(this.proposals.slice(-200), null, 2), "utf8"));
    return removed;
  }

  apply(id: string, selectedPaths?: string[]): DevelopmentProposal {
    const proposal = this.require(id);
    if (proposal.state !== "pending" && proposal.state !== "conflicted") throw new Error("这个开发提案当前不能应用。");
    const files = selectProposalFiles(proposal.files, selectedPaths);
    if (!files.length) throw new Error("请至少选择一个要应用的文件。");
    const conflicts = files.flatMap((file) => currentFileMatches(proposal.workspacePath, file) ? [] : [file.path]);
    if (conflicts.length) {
      proposal.state = "conflicted";
      proposal.conflicts = conflicts;
      proposal.updatedAt = new Date().toISOString();
      this.persist(proposal);
      return structuredClone(proposal);
    }
    // 写入过程中任何一步出问题，都要把已经落下的文件还原回去——
    // 半套修改留在项目里比完全没写更难收拾。
    const written: Array<{ target: string; base?: Buffer }> = [];
    try {
      for (const file of files) {
        const target = proposalTarget(proposal.workspacePath, file.path);
        written.push({
          target,
          base: file.baseContentBase64 ? Buffer.from(file.baseContentBase64, "base64") : undefined,
        });
        mkdirSync(dirname(target), { recursive: true });
        writeAtomic(target, Buffer.from(file.proposedContentBase64, "base64"));
      }
      // 写完再逐个核对落盘结果：写调用没报错不等于盘上内容就是提案内容。
      const mismatched = files
        .filter((file) => !fileHasHash(proposalTarget(proposal.workspacePath, file.path), file.proposedHash))
        .map((file) => file.path);
      if (mismatched.length) throw new Error(`写入结果与提案不一致：${mismatched.join("、")}`);
    } catch (error) {
      for (const entry of [...written].reverse()) restoreFile(entry.target, entry.base);
      proposal.state = "failed";
      proposal.error = error instanceof Error ? error.message : String(error);
      proposal.updatedAt = new Date().toISOString();
      this.persist(proposal);
      // 已经还原干净，但调用方必须知道这次没写成，不能当作成功继续往下走。
      throw new Error(`开发提案写入失败，项目已还原到写入前：${proposal.error}`);
    }
    proposal.state = "applied";
    proposal.appliedPaths = files.map((file) => file.path);
    delete proposal.conflicts;
    delete proposal.error;
    proposal.updatedAt = new Date().toISOString();
    this.persist(proposal);
    return structuredClone(proposal);
  }

  /**
   * 把一个已写入的提案回滚到写入前。
   *
   * 只有当盘上内容仍然是我们写下的那份时才回滚；否则说明这之后有人改过，
   * 直接回滚会把别人的修改一起抹掉，所以标成 conflicted 交回用户判断。
   */
  rollback(id: string): DevelopmentProposal {
    const proposal = this.require(id);
    if (proposal.state !== "applied") throw new Error("只有已写入项目的提案可以回滚。");
    const files = selectProposalFiles(proposal.files, proposal.appliedPaths);
    const drifted = files
      .filter((file) => !fileHasHash(proposalTarget(proposal.workspacePath, file.path), file.proposedHash))
      .map((file) => file.path);
    if (drifted.length) {
      proposal.state = "conflicted";
      proposal.conflicts = drifted;
      proposal.updatedAt = new Date().toISOString();
      this.persist(proposal);
      return structuredClone(proposal);
    }
    const restored: Array<{ target: string; proposed: Buffer }> = [];
    try {
      for (const file of files) {
        const target = proposalTarget(proposal.workspacePath, file.path);
        restored.push({ target, proposed: Buffer.from(file.proposedContentBase64, "base64") });
        restoreFile(target, file.baseContentBase64 ? Buffer.from(file.baseContentBase64, "base64") : undefined);
      }
      const failed = files
        .filter((file) => {
          const target = proposalTarget(proposal.workspacePath, file.path);
          // 新建的文件应当消失；被修改的文件应当回到 baseHash。
          return file.operation === "create"
            ? existsSync(target)
            : !file.baseHash || !fileHasHash(target, file.baseHash);
        })
        .map((file) => file.path);
      if (failed.length) throw new Error(`回滚结果与写入前不一致：${failed.join("、")}`);
    } catch (error) {
      // 回滚失败就把已还原的文件重新写回去，保持「要么全回滚，要么维持已写入」。
      for (const entry of [...restored].reverse()) writeAtomic(entry.target, entry.proposed);
      proposal.error = error instanceof Error ? error.message : String(error);
      proposal.updatedAt = new Date().toISOString();
      this.persist(proposal);
      throw new Error(`开发提案回滚失败，项目维持在已写入状态：${proposal.error}`);
    }
    proposal.state = "rolled_back";
    delete proposal.conflicts;
    delete proposal.error;
    proposal.updatedAt = new Date().toISOString();
    this.persist(proposal);
    return structuredClone(proposal);
  }

  reject(id: string): DevelopmentProposal {
    const proposal = this.require(id);
    if (proposal.state !== "pending" && proposal.state !== "conflicted") throw new Error("这个开发提案当前不能放弃。");
    proposal.state = "rejected";
    proposal.updatedAt = new Date().toISOString();
    this.persist(proposal);
    return structuredClone(proposal);
  }

  persist(proposal: DevelopmentProposal): void {
    const index = this.proposals.findIndex((item) => item.id === proposal.id);
    if (index >= 0) this.proposals[index] = structuredClone(proposal);
    else this.proposals.push(structuredClone(proposal));
    writeAtomic(this.file, Buffer.from(JSON.stringify(this.proposals.slice(-200), null, 2), "utf8"));
  }

  private require(id: string): DevelopmentProposal {
    const proposal = this.proposals.find((item) => item.id === id);
    if (!proposal) throw new Error("找不到这个开发提案。");
    return proposal;
  }

  private recoverInterrupted(): void {
    let changed = false;
    for (const proposal of this.proposals) {
      if (proposal.state !== "staging") continue;
      const conflicts: string[] = [];
      for (const file of [...proposal.files].reverse()) {
        const target = proposalTarget(proposal.workspacePath, file.path);
        if (!file.proposedHash || !fileHasHash(target, file.proposedHash)) {
          conflicts.push(file.path);
          continue;
        }
        restoreFile(target, file.baseContentBase64 ? Buffer.from(file.baseContentBase64, "base64") : undefined);
      }
      proposal.state = conflicts.length ? "conflicted" : "failed";
      proposal.conflicts = conflicts.length ? conflicts.reverse() : undefined;
      proposal.error = conflicts.length
        ? "上次开发执行中断；检测到外部文件变化，未自动覆盖。"
        : "上次开发执行中断，已恢复执行前文件。";
      proposal.updatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) writeAtomic(this.file, Buffer.from(JSON.stringify(this.proposals.slice(-200), null, 2), "utf8"));
  }
}

function toProposalFile(item: StagedFile): DevelopmentProposalFile {
  return {
    path: item.path,
    operation: item.baseContent ? "update" : "create",
    baseHash: item.baseContent ? digest(item.baseContent) : undefined,
    proposedHash: digest(item.proposedContent),
    byteLength: item.proposedContent.byteLength,
    baseContentBase64: item.baseContent?.toString("base64"),
    proposedContentBase64: item.proposedContent.toString("base64"),
  };
}

function workspaceRelativePath(workspacePath: string, absolutePath: string): string {
  const path = relative(workspacePath, absolutePath).replace(/\\/g, "/");
  if (!path || path === ".." || path.startsWith("../")) throw new Error("提案文件超出项目范围。");
  return path;
}

function proposalTarget(workspacePath: string, path: string): string {
  const target = resolve(workspacePath, path);
  workspaceRelativePath(workspacePath, target);
  return target;
}

function currentFileMatches(workspacePath: string, file: DevelopmentProposalFile): boolean {
  const target = proposalTarget(workspacePath, file.path);
  if (!existsSync(target)) return file.operation === "create";
  return !!file.baseHash && fileHasHash(target, file.baseHash);
}

function readBaseContent(workspacePath: string, path: string): Buffer | undefined {
  const target = proposalTarget(workspacePath, path);
  return existsSync(target) && statIsFile(target) ? readFileSync(target) : undefined;
}

function statIsFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function selectProposalFiles(files: DevelopmentProposalFile[], selectedPaths?: string[]): DevelopmentProposalFile[] {
  if (selectedPaths === undefined) return files;
  const selected = new Set(selectedPaths.map((path) => String(path).replace(/\\/g, "/")));
  const unknown = [...selected].filter((path) => !files.some((file) => file.path === path));
  if (unknown.length) throw new Error(`选择中包含不属于本提案的文件：${unknown.join("、")}`);
  return files.filter((file) => selected.has(file.path));
}

function fileHasHash(path: string, hash: string): boolean {
  return existsSync(path) && digest(readFileSync(path)) === hash;
}

function restoreFile(path: string, content?: Buffer): void {
  if (content) {
    mkdirSync(dirname(path), { recursive: true });
    writeAtomic(path, content);
  } else if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

function writeAtomic(path: string, content: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function readProposalFile(path: string): DevelopmentProposal[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function renderDevelopmentProposalHtml(proposal: DevelopmentProposal): string {
  const stateLabels: Record<DevelopmentProposalState, string> = {
    staging: "正在生成", pending: "等待确认", applied: "已写入项目", rejected: "已放弃", conflicted: "项目已变化", failed: "生成失败", rolled_back: "已回滚",
  };
  const sections = proposal.files.map((file) => {
    const before = file.baseContentBase64 ? Buffer.from(file.baseContentBase64, "base64").toString("utf8") : "（新文件）";
    const after = Buffer.from(file.proposedContentBase64, "base64").toString("utf8");
    return `<section><header><strong>${escapeHtml(file.path)}</strong><span>${file.operation === "create" ? "新建" : "修改"}</span></header><div class="compare"><div><h2>修改前</h2><pre>${escapeHtml(limitPreview(before))}</pre></div><div><h2>提案内容</h2><pre>${escapeHtml(limitPreview(after))}</pre></div></div></section>`;
  }).join("");
  const conflicts = proposal.conflicts?.length
    ? `<p class="warning">以下文件发生了其他变化，未自动覆盖：${proposal.conflicts.map(escapeHtml).join("、")}</p>`
    : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>开发修改提案</title><style>
  :root{color-scheme:light;--bg:#f5f1e9;--paper:#fffdf9;--ink:#24211d;--muted:#756f67;--line:#ded6ca;--accent:#a82f62}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.page{max-width:1320px;margin:0 auto;padding:42px 28px 80px}.eyebrow{color:var(--accent);font-weight:700;font-size:13px}h1{margin:5px 0 8px;font-size:30px;letter-spacing:-.03em}.summary{margin:0 0 28px;color:var(--muted)}.warning{padding:12px 15px;border:1px solid #d8a7b9;background:#fff5f8;border-radius:8px}section{margin:18px 0;background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden}section>header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid var(--line)}section>header span{color:var(--muted);font-size:12px}.compare{display:grid;grid-template-columns:1fr 1fr}.compare>div{min-width:0;padding:15px}.compare>div+div{border-left:1px solid var(--line)}h2{margin:0 0 9px;color:var(--muted);font-size:12px;font-weight:600}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12.5px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:760px){.page{padding:24px 14px 50px}.compare{grid-template-columns:1fr}.compare>div+div{border-left:0;border-top:1px solid var(--line)}}</style></head><body><main class="page"><div class="eyebrow">开发修改提案 · ${stateLabels[proposal.state]}</div><h1>${proposal.files.length} 个文件等待核对</h1><p class="summary">修改尚未写入正式项目。确认内容无误后，请回到能力页选择“写入项目”。</p>${conflicts}${sections || "<p>本次没有产生文件修改。</p>"}</main></body></html>`;
}

function limitPreview(value: string): string {
  return value.length <= 120_000 ? value : `${value.slice(0, 120_000)}\n\n……内容过长，预览已截断……`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}
