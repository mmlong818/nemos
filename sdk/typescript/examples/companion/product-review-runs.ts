import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ProductReviewSeverity = "low" | "medium" | "high";

export interface ProductReviewIssue {
  severity: ProductReviewSeverity;
  title: string;
  detail: string;
  fixed?: boolean;
}

export interface ProductReviewRun {
  id: string;
  round: number;
  persona: string;
  scenario: string;
  route: string;
  status: "passed" | "issues" | "blocked";
  observations: string[];
  issues: ProductReviewIssue[];
  evidence: string[];
  createdAt: string;
}

export class ProductReviewRunStore {
  private readonly file: string;
  private runs: ProductReviewRun[];

  constructor(dataDir: string) {
    this.file = join(dataDir, "product-review-runs.json");
    this.runs = this.read();
  }

  list(): ProductReviewRun[] {
    return [...this.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  summary() {
    const runs = this.list();
    const issues = runs.flatMap((run) => run.issues);
    return {
      total: runs.length,
      passed: runs.filter((run) => run.status === "passed").length,
      blocked: runs.filter((run) => run.status === "blocked").length,
      openIssues: issues.filter((issue) => !issue.fixed).length,
      highIssues: issues.filter((issue) => !issue.fixed && issue.severity === "high").length,
      latestAt: runs[0]?.createdAt ?? null,
    };
  }

  append(input: Omit<ProductReviewRun, "id" | "createdAt">): ProductReviewRun {
    const round = Math.max(1, Math.floor(Number(input.round)));
    if (!input.persona.trim() || !input.scenario.trim() || !input.route.trim()) {
      throw new Error("真实检查必须记录人物、场景和访问路径。");
    }
    if (!input.observations.length) throw new Error("真实检查至少需要一条实际观察。");
    const createdAt = new Date().toISOString();
    const run: ProductReviewRun = {
      id: `review-${createdAt.replace(/[^0-9]/g, "")}-${round}`,
      round,
      persona: input.persona.trim().slice(0, 80),
      scenario: input.scenario.trim().slice(0, 240),
      route: input.route.trim().slice(0, 240),
      status: input.status,
      observations: input.observations.map((item) => item.trim()).filter(Boolean).slice(0, 30),
      issues: input.issues.slice(0, 30).map((issue) => ({
        severity: issue.severity,
        title: issue.title.trim().slice(0, 120),
        detail: issue.detail.trim().slice(0, 1000),
        fixed: issue.fixed === true,
      })),
      evidence: input.evidence.map((item) => item.trim()).filter(Boolean).slice(0, 20),
      createdAt,
    };
    this.runs.push(run);
    this.persist();
    return run;
  }

  clear(): void {
    this.runs = [];
    this.persist();
  }

  private read(): ProductReviewRun[] {
    if (!existsSync(this.file)) return [];
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.runs, null, 2), "utf8");
  }
}
