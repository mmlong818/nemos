export interface DevelopmentRunSnapshot {
  artifactId: string;
  engine?: string;
  changedFiles?: string[];
  checks?: Array<{ passed: boolean }>;
  contextFingerprints?: string[];
  sessionResumed?: boolean;
}

export interface DevelopmentRunComparison {
  version: 1;
  previousArtifactId: string;
  addedFiles: string[];
  removedFiles: string[];
  retainedFiles: string[];
  passedChecks: number;
  failedChecks: number;
  checkDelta: number;
  contextAdded: number;
  contextRemoved: number;
  engineChanged: boolean;
  sessionResumed: boolean;
  summary: string;
}

export function compareDevelopmentRuns(previous: DevelopmentRunSnapshot, current: DevelopmentRunSnapshot): DevelopmentRunComparison {
  const previousFiles = new Set(cleanList(previous.changedFiles));
  const currentFiles = new Set(cleanList(current.changedFiles));
  const previousContext = new Set(cleanList(previous.contextFingerprints));
  const currentContext = new Set(cleanList(current.contextFingerprints));
  const addedFiles = [...currentFiles].filter((path) => !previousFiles.has(path));
  const removedFiles = [...previousFiles].filter((path) => !currentFiles.has(path));
  const retainedFiles = [...currentFiles].filter((path) => previousFiles.has(path));
  const passedChecks = (current.checks || []).filter((check) => check.passed).length;
  const failedChecks = (current.checks || []).filter((check) => !check.passed).length;
  const previousPassed = (previous.checks || []).filter((check) => check.passed).length;
  const contextAdded = [...currentContext].filter((id) => !previousContext.has(id)).length;
  const contextRemoved = [...previousContext].filter((id) => !currentContext.has(id)).length;
  const summary = [
    `${currentFiles.size} 个文件`,
    `${passedChecks} 项检查通过`,
    failedChecks ? `${failedChecks} 项未通过` : "没有失败检查",
    current.sessionResumed ? "沿用原开发会话" : "使用新开发会话",
  ].join(" · ");
  return {
    version: 1,
    previousArtifactId: previous.artifactId,
    addedFiles,
    removedFiles,
    retainedFiles,
    passedChecks,
    failedChecks,
    checkDelta: passedChecks - previousPassed,
    contextAdded,
    contextRemoved,
    engineChanged: Boolean(previous.engine && current.engine && previous.engine !== current.engine),
    sessionResumed: current.sessionResumed === true,
    summary,
  };
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];
}
