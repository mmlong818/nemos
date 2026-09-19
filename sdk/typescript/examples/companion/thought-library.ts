import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type ThoughtUnitKind = "person" | "role" | "framework";
export type ThoughtUnitStatus = "draft" | "review" | "approved" | "published";

export interface ThoughtProvenance {
  kind: "public_source" | "user_material" | "user_defined";
  label: string;
}

export interface ThoughtUnit {
  id: string;
  ownerScope: string;
  displayName: string;
  kind: ThoughtUnitKind;
  provenance: ThoughtProvenance[];
  applicableProblems: string[];
  corePrinciples: string[];
  judgmentSteps: string[];
  counterexamplesAndLimits: string[];
  questioningStyle: string[];
  uncertaintyStatements: string[];
  identityDisclaimer: string;
  version: number;
  status: ThoughtUnitStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThoughtDraftInput {
  displayName: string;
  kind: ThoughtUnitKind;
  sourceLabel?: string;
  sourceKind?: "public_source" | "user_material";
  material?: string;
}

export type ThoughtDraftPatch = Partial<Pick<ThoughtUnit,
  "displayName" | "applicableProblems" | "corePrinciples" | "judgmentSteps" |
  "counterexamplesAndLimits" | "questioningStyle" | "uncertaintyStatements"
>>;

export interface ThoughtDistillationRequest {
  system: string;
  user: string;
  maxTokens: number;
  runId: string;
  sessionId: string;
}

export type ThoughtDistillationCompletion = (request: ThoughtDistillationRequest) => Promise<string>;

export interface ThoughtLibraryOptions {
  completion?: ThoughtDistillationCompletion;
  scopeId?: string;
  idFactory?: () => string;
  now?: () => string;
}

interface StoredThoughtLibrary { version: 1; units: ThoughtUnit[] }

const ARRAY_FIELDS = [
  "applicableProblems",
  "corePrinciples",
  "judgmentSteps",
  "counterexamplesAndLimits",
  "questioningStyle",
  "uncertaintyStatements",
] as const;

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanList(value: unknown, maxItems = 8): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean).slice(0, maxItems)
    : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function identityDisclaimer(kind: ThoughtUnitKind): string {
  return kind === "person"
    ? "这是对用户所给公开思想材料的结构化蒸馏，不是本人代理、数字分身，也不代表本人观点。"
    : kind === "role"
      ? "这是用户定义角色的思考程序，不是对任何真实人物或群体的模拟。"
      : "这是可审阅的思维框架，不具有人格、权威或事实保证。";
}

export class ThoughtLibraryStore {
  private units: ThoughtUnit[];
  private loadError = "";
  private readonly completion?: ThoughtDistillationCompletion;
  private readonly scopeId: string;
  private readonly idFactory: () => string;
  private readonly now: () => string;

  constructor(private readonly file: string, options: ThoughtLibraryOptions = {}) {
    this.completion = options.completion;
    this.scopeId = options.scopeId ?? "local";
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.units = this.load();
  }

  list(): ThoughtUnit[] {
    this.ensureHealthy();
    return clone(this.units.filter((unit) => unit.ownerScope === this.scopeId));
  }

  eligibleUnits(): ThoughtUnit[] {
    this.ensureHealthy();
    return clone(this.units.filter((unit) => unit.ownerScope === this.scopeId && unit.enabled && (unit.status === "approved" || unit.status === "published")));
  }

  get(id: string): ThoughtUnit | undefined {
    this.ensureHealthy();
    const unit = this.units.find((candidate) => candidate.id === id && candidate.ownerScope === this.scopeId);
    return unit ? clone(unit) : undefined;
  }

  async createDraft(input: ThoughtDraftInput): Promise<ThoughtUnit> {
    this.ensureHealthy();
    const displayName = cleanText(input.displayName, 80);
    if (!displayName) throw new Error("请填写思维单元名称");
    const material = cleanText(input.material, 20_000);
    const sourceLabel = cleanText(input.sourceLabel, 160);
    const hasMaterial = Boolean(material);
    const provenance: ThoughtProvenance[] = hasMaterial
      ? [{ kind: input.sourceKind ?? "user_material", label: sourceLabel || "用户提供的材料" }]
      : [{ kind: "user_defined", label: "用户定义（未提供外部来源）" }];
    let distilled: Record<string, unknown> = {};
    if (hasMaterial && this.completion) {
      const raw = await this.completion({
        system: [
          "你是思维方法编辑器，只能整理用户给出的材料，不得调用外部知识或补充人物事实。",
          "输出一个 JSON 对象，只含 applicableProblems、corePrinciples、judgmentSteps、counterexamplesAndLimits、questioningStyle、uncertaintyStatements 六个字符串数组。",
          "材料没有支持的内容必须留空并写入不确定声明。不得模拟、代言或冒充真实人物。",
        ].join("\n"),
        user: `名称：${displayName}\n类型：${input.kind}\n来源标签：${sourceLabel || "用户提供的材料"}\n材料：\n${material}`,
        maxTokens: 900,
        runId: `pantheon/distill/${this.idFactory()}`,
        sessionId: "pantheon-thought-distillation",
      });
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) distilled = parsed as Record<string, unknown>;
      } catch {
        throw new Error("思维蒸馏没有返回可审阅的结构化草案，请重试或手动填写");
      }
    }
    const timestamp = this.now();
    const uncertainty = cleanList(distilled.uncertaintyStatements);
    if (!hasMaterial) uncertainty.unshift("未提供可核验材料；以下仅为用户定义框架，不包含关于人物或体系的事实主张。");
    else uncertainty.unshift("仅根据用户提供的材料整理，未联网核验完整性或真实性。");
    const unit: ThoughtUnit = {
      id: `private:${this.idFactory()}`,
      ownerScope: this.scopeId,
      displayName,
      kind: input.kind,
      provenance,
      applicableProblems: cleanList(distilled.applicableProblems),
      corePrinciples: cleanList(distilled.corePrinciples),
      judgmentSteps: cleanList(distilled.judgmentSteps),
      counterexamplesAndLimits: cleanList(distilled.counterexamplesAndLimits),
      questioningStyle: cleanList(distilled.questioningStyle),
      uncertaintyStatements: [...new Set(uncertainty)].slice(0, 8),
      identityDisclaimer: identityDisclaimer(input.kind),
      version: 1,
      status: "draft",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.units.push(unit);
    this.persist();
    return clone(unit);
  }

  updateDraft(id: string, patch: ThoughtDraftPatch): ThoughtUnit {
    const unit = this.requireUnit(id);
    if (unit.status === "approved" || unit.status === "published") throw new Error("已确认的思维单元不可直接改写；请另建新版本");
    if (patch.displayName !== undefined) {
      const name = cleanText(patch.displayName, 80);
      if (!name) throw new Error("思维单元名称不能为空");
      unit.displayName = name;
    }
    for (const field of ARRAY_FIELDS) {
      if (patch[field] !== undefined) unit[field] = cleanList(patch[field]);
    }
    unit.updatedAt = this.now();
    this.persist();
    return clone(unit);
  }

  transition(id: string, action: "submit_review" | "approve" | "publish"): ThoughtUnit {
    const unit = this.requireUnit(id);
    if (action === "submit_review" && unit.status === "draft") unit.status = "review";
    else if (action === "approve" && unit.status === "review") unit.status = "approved";
    else if (action === "publish" && unit.status === "approved") unit.status = "published";
    else throw new Error("当前状态不允许这项操作");
    unit.updatedAt = this.now();
    this.persist();
    return clone(unit);
  }

  setEnabled(id: string, enabled: boolean): ThoughtUnit {
    const unit = this.requireUnit(id);
    unit.enabled = enabled;
    unit.updatedAt = this.now();
    this.persist();
    return clone(unit);
  }

  remove(id: string): boolean {
    this.ensureHealthy();
    if (!id.startsWith("private:")) throw new Error("只能删除本地私有思维单元");
    const before = this.units.length;
    this.units = this.units.filter((unit) => unit.id !== id || unit.ownerScope !== this.scopeId);
    if (this.units.length !== before) this.persist();
    return this.units.length !== before;
  }

  private requireUnit(id: string): ThoughtUnit {
    this.ensureHealthy();
    const unit = this.units.find((candidate) => candidate.id === id && candidate.ownerScope === this.scopeId);
    if (!unit) throw new Error("找不到这个思维单元");
    return unit;
  }

  private load(): ThoughtUnit[] {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as StoredThoughtLibrary;
      if (parsed.version !== 1 || !Array.isArray(parsed.units)) throw new Error("unsupported thought library format");
      return parsed.units;
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}.bak`;
      try { copyFileSync(this.file, backup); }
      catch { /* Keep the original untouched even when backup creation fails. */ }
      this.loadError = `本地思维库文件已损坏，原文件未被覆盖。请从备份恢复后再试（${error instanceof Error ? error.message : "无法解析"}）`;
      return [];
    }
  }

  private ensureHealthy(): void {
    if (this.loadError) throw new Error(this.loadError);
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, units: this.units } satisfies StoredThoughtLibrary, null, 2), "utf8");
    renameSync(temporary, this.file);
  }
}
