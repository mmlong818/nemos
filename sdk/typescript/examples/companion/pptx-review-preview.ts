import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { ArtifactReviewError, sameArtifactIdentity, validArtifactFingerprint, type ArtifactPreviewIdentity, type ReviewedArtifactIdentity } from "./artifact-reviews.js";

interface StoredPreview extends ArtifactPreviewIdentity {
  artifactId: string;
  source: ReviewedArtifactIdentity;
}

export const MAX_PPTX_REVIEW_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 50;
const runFile = promisify(execFile);
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });

function powerPointPath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .flatMap((root) => root ? [join(root, "Microsoft Office", "root", "Office16", "POWERPNT.EXE"), join(root, "Microsoft Office", "Office16", "POWERPNT.EXE")] : [])
    .find(existsSync);
}

function powerShellPath(): string | undefined {
  if (process.platform !== "win32" || !process.env.SystemRoot) return undefined;
  const executable = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(executable) ? executable : undefined;
}

export class PptxReviewPreviewStore {
  private preparing = false;

  constructor(private readonly directory: string) {}

  available(): boolean {
    return !!powerPointPath() && !!powerShellPath();
  }

  read(artifactId: string, source: ReviewedArtifactIdentity): { preview: ArtifactPreviewIdentity; data: Buffer } | null {
    const key = this.storageKey(artifactId, source);
    const index = join(this.directory, key + ".json");
    const file = join(this.directory, key + ".pdf");
    if (!existsSync(index) && !existsSync(file)) return null;
    try {
      if (dirname(realpathSync(index)) !== realpathSync(this.directory)
          || dirname(realpathSync(file)) !== realpathSync(this.directory)) throw new Error("Invalid review preview path");
      const raw: StoredPreview = JSON.parse(readFileSync(index, "utf8"));
      if (raw.artifactId !== artifactId || !validArtifactFingerprint(raw.source)
          || !sameArtifactIdentity(raw.source, source) || !validArtifactFingerprint(raw)
          || raw.byteLength > MAX_PDF_BYTES || !Number.isInteger(raw.pages)
          || raw.pages < 1 || raw.pages > MAX_PAGES || statSync(file).size !== raw.byteLength) throw new Error("Invalid preview metadata");
      const data = readFileSync(file);
      if (data.byteLength !== raw.byteLength || sha256(data) !== raw.sha256) throw new Error("Invalid preview bytes");
      return { preview: { sha256: raw.sha256, byteLength: raw.byteLength, pages: raw.pages }, data };
    } catch {
      throw new ArtifactReviewError(409, "这份 PPTX 的审阅预览已损坏或缺失，请重新生成成果后再审阅。");
    }
  }

  async prepare(artifactId: string, source: ReviewedArtifactIdentity, data: Buffer): Promise<ArtifactPreviewIdentity> {
    const existing = this.read(artifactId, source);
    if (existing) return existing.preview;
    const office = powerPointPath();
    const shell = powerShellPath();
    if (!office || !shell) throw new ArtifactReviewError(422, "当前电脑未找到可用的本机 PowerPoint 预览环境。");
    if (this.preparing) throw new ArtifactReviewError(409, "正在准备另一份演示预览，请稍后重试。");
    this.preparing = true;
    try {
      const slides = await safeSlideCount(data);
      const pdf = await renderPowerPointPdf(office, shell, data);
      await verifyPdfPages(pdf, slides);
      const preview = { sha256: sha256(pdf), byteLength: pdf.byteLength, pages: slides };
      this.persist(artifactId, source, preview, pdf);
      return preview;
    } finally {
      this.preparing = false;
    }
  }

  remove(artifactId: string, source: ReviewedArtifactIdentity): void {
    const key = this.storageKey(artifactId, source);
    removeFile(join(this.directory, key + ".json"));
    removeFile(join(this.directory, key + ".pdf"));
  }

  private persist(artifactId: string, source: ReviewedArtifactIdentity, preview: ArtifactPreviewIdentity, data: Buffer): void {
    mkdirSync(this.directory, { recursive: true });
    const key = this.storageKey(artifactId, source);
    const file = join(this.directory, key + ".pdf");
    const index = join(this.directory, key + ".json");
    const tmpFile = file + "." + randomUUID() + ".tmp";
    const tmpIndex = index + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmpFile, data, { flag: "wx" });
      writeFileSync(tmpIndex, JSON.stringify({ artifactId, source, ...preview }), { flag: "wx" });
      renameSync(tmpFile, file);
      renameSync(tmpIndex, index);
    } finally {
      removeFile(tmpFile);
      removeFile(tmpIndex);
    }
  }

  private storageKey(artifactId: string, source: ReviewedArtifactIdentity): string {
    return sha256(Buffer.from(JSON.stringify([artifactId, source.format, source.sha256, source.byteLength])));
  }
}

async function safeSlideCount(data: Buffer): Promise<number> {
  if (data.byteLength > MAX_PPTX_REVIEW_BYTES) throw new ArtifactReviewError(422, "PPTX 超过 20 MB，暂不能生成审阅预览。");
  const zip = await JSZip.loadAsync(data);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (/vbaProject\.bin$|^ppt\/activeX\/|^ppt\/(?:charts\/external|oleObjects\/)/i.test(name)
        || /^ppt\/embeddings\/.+/i.test(name) && !entry.dir && !name.toLowerCase().endsWith(".xlsx")) {
      throw new ArtifactReviewError(422, "含宏或活动对象的 PPTX 暂不支持审阅预览。");
    }
    if (!entry.dir && name.toLowerCase().endsWith(".rels")) {
      const relations = xmlParser.parse(await entry.async("string")).Relationships?.Relationship;
      const list = Array.isArray(relations) ? relations : relations ? [relations] : [];
      if (list.some((item) => String(item["@_TargetMode"] || "").toLowerCase() === "external")) {
        throw new ArtifactReviewError(422, "含外部链接的 PPTX 暂不支持审阅预览。");
      }
    }
    if (!entry.dir && /^ppt\/embeddings\/.+\.xlsx$/i.test(name)) {
      const embedded = await JSZip.loadAsync(await entry.async("nodebuffer"));
      if (Object.keys(embedded.files).some((part) => /(?:externalLinks|connections\.xml|vbaProject\.bin)/i.test(part))) {
        throw new ArtifactReviewError(422, "含外部数据的嵌入工作表暂不支持审阅预览。");
      }
      for (const [part, item] of Object.entries(embedded.files)) {
        if (part.toLowerCase().endsWith(".rels") && /\bTargetMode\s*=\s*["']External["']/i.test(await item.async("string"))) {
          throw new ArtifactReviewError(422, "含外部链接的嵌入工作表暂不支持审阅预览。");
        }
      }
    }
  }
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const slides = presentation ? xmlParser.parse(presentation).presentation?.sldIdLst?.sldId : undefined;
  const pages = Array.isArray(slides) ? slides.length : slides ? 1 : 0;
  if (!pages || pages > MAX_PAGES) throw new ArtifactReviewError(422, "审阅预览须包含 1 至 50 张幻灯片。");
  return pages;
}

async function verifyPdfPages(data: Buffer, expected: number): Promise<void> {
  try {
    if (data.byteLength > MAX_PDF_BYTES || data.subarray(0, 5).toString("latin1") !== "%PDF-"
        || !data.subarray(-2048).includes("%%EOF")) throw new Error("Invalid PDF");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument({ data: Uint8Array.from(data), isEvalSupported: false, useWorkerFetch: false, stopAtErrors: true });
    try {
      const doc = await loading.promise;
      if (doc.numPages !== expected) throw new Error("Missing PPTX preview pages");
      for (let page = 1; page <= expected; page += 1) {
        const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
        if (!(viewport.width > 0 && viewport.height > 0)) throw new Error("Invalid page size");
      }
    } finally {
      await loading.destroy();
    }
  } catch {
    throw new ArtifactReviewError(422, "PowerPoint 预览不完整，未开放确认。");
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function removeFile(file: string): void {
  try { unlinkSync(file); } catch { /* File not created or still locked. */ }
}

async function renderPowerPointPdf(office: string, shell: string, original: Buffer): Promise<Buffer> {
  const stage = mkdtempSync(join(tmpdir(), "nemos-pptx-review-"));
  const source = join(stage, "source.pptx");
  const destination = join(stage, "preview.pdf");
  try {
    writeFileSync(source, original, { flag: "wx" });
    try {
      await runFile(shell, ["-NoProfile", "-NonInteractive", "-Command", POWERPOINT_SCRIPT], {
        cwd: stage,
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: stage,
          TMP: stage,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          APPDATA: process.env.APPDATA,
          USERPROFILE: process.env.USERPROFILE,
          NEMOS_POWERPOINT: office,
          NEMOS_PPTX: source,
          NEMOS_PREVIEW_PDF: destination,
        },
        windowsHide: true,
        timeout: 45_000,
        maxBuffer: 32 * 1024,
      });
      if (!readFileSync(source).equals(original) || statSync(destination).size > MAX_PDF_BYTES) {
        throw new Error("Unexpected preview file");
      }
      return readFileSync(destination);
    } catch (error) {
      const failure = error as { stderr?: string; killed?: boolean };
      if (failure.stderr?.includes("NEMOS_PPTX_BUSY")) throw new ArtifactReviewError(409, "PowerPoint 正在使用中。关闭后重试，现有文稿不会被改动。");
      if (failure.killed) throw new ArtifactReviewError(422, "准备 PowerPoint 预览已超时。请检查 PowerPoint 是否有提示，再重试。");
      throw new ArtifactReviewError(422, "本机 PowerPoint 无法生成可审核的静态预览。");
    }
  } finally {
    removeFile(destination);
    removeFile(source);
    removeFile(join(stage, "~$source.pptx"));
    try { rmdirSync(stage); } catch { /* Do not delete unexpected files or folders. */ }
  }
}

const POWERPOINT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if (Get-Process -Name POWERPNT -ErrorAction SilentlyContinue) { throw 'NEMOS_PPTX_BUSY' }
$application = $null
$presentation = $null
$verifiedOwner = $false
$security = $null
$alerts = $null
try {
  $activation = [DateTime]::UtcNow
  $application = New-Object -ComObject PowerPoint.Application
  $officeProcesses = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
  if ($officeProcesses.Count -ne 1 -or $officeProcesses[0].StartTime.ToUniversalTime() -lt $activation -or
      $officeProcesses[0].SessionId -ne [System.Diagnostics.Process]::GetCurrentProcess().SessionId) { throw 'NEMOS_PPTX_BUSY' }
  $officeProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($officeProcesses[0].Id)"
  if ($officeProcess.ExecutablePath -ine $env:NEMOS_POWERPOINT -or
      $officeProcess.CommandLine -notmatch '\s/AUTOMATION\b' -or
      $officeProcess.CommandLine -notmatch '\s-Embedding\b' -or $application.Visible -ne 0 -or
      $application.Presentations.Count -ne 0) { throw 'NEMOS_PPTX_BUSY' }
  $verifiedOwner = $true
  $security = $application.AutomationSecurity
  $alerts = $application.DisplayAlerts
  $application.AutomationSecurity = 3
  $application.DisplayAlerts = 1
  $presentation = $application.Presentations.Open($env:NEMOS_PPTX, -1, 0, 0)
  $presentation.SaveAs($env:NEMOS_PREVIEW_PDF, 32, 0)
} finally {
  if ($presentation) {
    try { $presentation.Close() } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
  }
  if ($application) {
    if ($verifiedOwner) {
      try { if ($null -ne $security) { $application.AutomationSecurity = $security } } catch {}
      try { if ($null -ne $alerts) { $application.DisplayAlerts = $alerts } } catch {}
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
  }
}
`;
