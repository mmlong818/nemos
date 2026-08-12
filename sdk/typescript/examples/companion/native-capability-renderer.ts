import { readFileSync, statSync, writeFileSync } from "node:fs";
import PptxGenJS from "pptxgenjs";

import type { ArtifactFormat } from "./capabilities.js";
import { exportOfficeDocument } from "./office-export.js";
import {
  parseNativeCapabilityPayload,
  type NativeCapabilityId,
  type NativeCapabilityPayload,
} from "./native-capability-contracts.js";
import { reviewPresentationPreview, type PresentationVisualReview } from "./presentation-visual-review.js";

export interface NativeArtifactMetadata {
  generatedAbilityId?: string;
  artifactId?: string;
}

export interface NativeArtifactValidationCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "not-run";
  phase?: "validation" | "verification";
  detail?: string;
}

export interface NativeRenderedArtifact {
  format: ArtifactFormat;
  file: string;
  previewFile?: string;
  summary: string;
  validationChecks: NativeArtifactValidationCheck[];
  visualReview?: PresentationVisualReview;
}

export async function writeNativeCapabilityArtifact(input: {
  capabilityId: NativeCapabilityId;
  title: string;
  raw: string;
  requestedFormat: ArtifactFormat;
  fileBase: string;
  metadata?: NativeArtifactMetadata;
}): Promise<NativeRenderedArtifact> {
  const payload = parseNativeCapabilityPayload(input.capabilityId, input.raw);
  if (input.capabilityId === "presentation-builder" && input.requestedFormat === "pptx") {
    const file = `${input.fileBase}.pptx`;
    const previewFile = `${input.fileBase}-preview.html`;
    await writePresentation(file, payload);
    writeFileSync(previewFile, renderPresentation(payload, input.metadata), "utf8");
    return await finalizeNativeArtifact({ format: "pptx", file, previewFile, summary: payload.summary }, payload);
  }

  if (input.requestedFormat === "doc" || input.requestedFormat === "pdf" || input.requestedFormat === "xlsx") {
    const target = input.requestedFormat === "doc" ? "docx" : input.requestedFormat;
    const exported = await exportOfficeDocument({
      name: input.title,
      format: target,
      blocks: payloadToOfficeBlocks(payload),
    });
    const extension = input.requestedFormat === "doc" ? "docx" : input.requestedFormat;
    const file = input.fileBase + "." + extension;
    writeFileSync(file, exported.data);
    const previewFile = input.fileBase + "-preview.html";
    writeFileSync(previewFile, renderWorkbench(payload, input.metadata), "utf8");
    return await finalizeNativeArtifact({ format: input.requestedFormat, file, previewFile, summary: payload.summary }, payload);
  }

  if (input.requestedFormat === "html" || nativeDefaultIsWorkbench(input.capabilityId, input.requestedFormat)) {
    const file = `${input.fileBase}.html`;
    writeFileSync(file, renderWorkbench(payload, input.metadata), "utf8");
    return await finalizeNativeArtifact({ format: "html", file, summary: payload.summary }, payload);
  }

  if (input.requestedFormat === "json") {
    const file = `${input.fileBase}.json`;
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    return await finalizeNativeArtifact({ format: "json", file, summary: payload.summary }, payload);
  }

  // doc/pdf/xlsx 已在上面的 Office 分支处理并返回，这里只剩 txt/md/pptx。
  const format = input.requestedFormat === "txt" ? "txt" : "md";
  const extension = format === "txt" ? "txt" : "md";
  const file = `${input.fileBase}.${extension}`;
  writeFileSync(file, renderNativeCapabilityMarkdown(payload), "utf8");
  return await finalizeNativeArtifact({ format, file, summary: payload.summary }, payload);
}

async function finalizeNativeArtifact(
  artifact: Omit<NativeRenderedArtifact, "validationChecks">,
  payload: NativeCapabilityPayload,
): Promise<NativeRenderedArtifact> {
  const content = readFileSync(artifact.file);
  const checks: NativeArtifactValidationCheck[] = [{
    id: "artifact-readable",
    label: "交付文件可读取且非空",
    status: content.byteLength > 32 ? "passed" : "failed",
    detail: `${content.byteLength} bytes`,
  }];
  if (artifact.previewFile) {
    const previewBytes = statSync(artifact.previewFile).size;
    checks.push({ id: "preview-readable", label: "预览文件可读取且非空", status: previewBytes > 32 ? "passed" : "failed", detail: `${previewBytes} bytes` });
  }
  let visualReview: PresentationVisualReview | undefined;
  if (payload.kind === "presentation-builder" && artifact.format === "pptx") {
    const slides = records(payload.data.slides);
    const warnings = presentationWarnings(slides);
    const layouts = new Set(slides.map((slide) => text(slide.layout) || "statement"));
    const notesCount = slides.filter((slide) => !!text(slide.speakerNotes)).length;
    checks.push({ id: "pptx-signature", label: "PowerPoint 文件结构有效", status: content.subarray(0, 2).toString() === "PK" ? "passed" : "failed" });
    checks.push({ id: "slide-contract", label: "页数和逐页主旨符合约定", status: slides.length >= 3 && slides.length <= 30 && slides.every((slide) => !!text(slide.title) && !!text(slide.keyMessage)) ? "passed" : "failed", detail: `${slides.length} 页` });
    checks.push({ id: "slide-density", label: "逐页文字密度适合放映", status: warnings.length === 0 ? "passed" : "failed", detail: warnings.length ? warnings.join(" ") : "未发现溢出风险" });
    checks.push({ id: "slide-layout-variety", label: "版式具有必要变化", status: layouts.size >= Math.min(3, slides.length) ? "passed" : "failed", detail: `${layouts.size} 种版式` });
    checks.push({ id: "speaker-notes", label: "演讲备注覆盖主要页面", status: notesCount >= Math.ceil(slides.length * 0.6) ? "passed" : "failed", detail: `${notesCount}/${slides.length} 页` });
    if (artifact.previewFile) {
      visualReview = await reviewPresentationPreview(artifact.previewFile, slides.length);
      checks.push({
        id: "key-slide-visual-review",
        label: "关键页真实渲染复核",
        status: visualReview.unavailableReason ? "not-run" : visualReview.passed ? "passed" : "failed",
        phase: "verification",
        detail: visualReview.unavailableReason || visualReview.pages.map((page) => `第 ${page.slide + 1} 页：${page.detail}`).join("；"),
      });
    }
  }
  if (payload.kind === "research-brief") checks.push(researchEvidenceCheck(payload));
  return { ...artifact, validationChecks: checks, visualReview };
}

function researchEvidenceCheck(payload: NativeCapabilityPayload): NativeArtifactValidationCheck {
  const sourceIds = new Set(records(payload.data.sources).map((source) => text(source.id)).filter(Boolean));
  const findings = records(payload.data.findings);
  const invalid = findings.filter((finding) => {
    const status = text(finding.status);
    const evidenceIds = strings(finding.evidenceIds);
    return status === "confirmed" && (evidenceIds.length === 0 || evidenceIds.some((id) => !sourceIds.has(id)));
  });
  return {
    id: "research-evidence-links",
    label: "已确认结论均可追溯到来源",
    status: invalid.length === 0 ? "passed" : "failed",
    detail: invalid.length === 0 ? `${findings.length} 条发现` : `${invalid.length} 条已确认结论缺少有效来源`,
  };
}

function payloadToOfficeBlocks(payload: NativeCapabilityPayload): Array<{ title: string; text: string }> {
  const blocks: Array<{ title: string; text: string }> = [
    { title: "摘要", text: payload.summary },
  ];
  for (const [key, value] of Object.entries(payload.data)) {
    blocks.push({ title: labelFor(key), text: markdownValue(value) });
  }
  return blocks;
}

function nativeDefaultIsWorkbench(id: NativeCapabilityId, requested: ArtifactFormat): boolean {
  return requested === "pptx" && id !== "presentation-builder";
}

async function writePresentation(file: string, payload: NativeCapabilityPayload): Promise<void> {
  const data = payload.data;
  const slides = records(data.slides);
  const palette = presentationPalette(text(data.theme) || "sand");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "小丑鱼";
  pptx.company = "小丑鱼";
  pptx.subject = text(data.purpose);
  pptx.title = payload.title;
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };

  for (const [index, item] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: palette.background };
    slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 0.62, w: 0.44, h: 0, line: { color: palette.accent, width: 3 } });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: 11.95, y: 0.42, w: 0.7, h: 0.28, fontFace: "Aptos", fontSize: 10, color: palette.muted, align: "right", margin: 0,
    });
    const layout = text(item.layout) || "statement";
    const title = text(item.title) || `第 ${index + 1} 页`;
    const message = text(item.keyMessage);
    const bullets = strings(item.bullets).slice(0, 6);

    if (layout === "title") {
      slide.addText(title, { x: 0.78, y: 1.45, w: 11.2, h: 1.25, fontSize: 34, bold: true, color: palette.text, breakLine: false, margin: 0.03, fit: "shrink" });
      slide.addText(message, { x: 0.82, y: 3.0, w: 9.6, h: 0.85, fontSize: 18, color: palette.muted, margin: 0.03, fit: "shrink" });
      slide.addShape(pptx.ShapeType.rect, { x: 0.82, y: 5.65, w: 3.0, h: 0.12, line: { transparency: 100 }, fill: { color: palette.accent } });
    } else if (layout === "comparison" || layout === "two-column") {
      addSlideHeading(slide, title, message, palette);
      const midpoint = Math.max(1, Math.ceil(bullets.length / 2));
      addBulletCard(slide, bullets.slice(0, midpoint), 0.82, 3.05, 5.55, 2.85, palette, pptx.ShapeType.roundRect, "A");
      addBulletCard(slide, bullets.slice(midpoint), 6.7, 3.05, 5.55, 2.85, palette, pptx.ShapeType.roundRect, "B");
    } else if (layout === "chart") {
      addSlideHeading(slide, title, message, palette);
      addSlideChart(slide, bullets, palette, pptx);
    } else if (layout === "visual" && isSupportedPresentationImageData(text(item.imageData))) {
      addSlideHeading(slide, title, message, palette);
      addBulletCard(slide, bullets, 0.82, 3.0, 5.25, 3.0, palette, pptx.ShapeType.roundRect);
      slide.addImage({ data: text(item.imageData), x: 6.4, y: 2.7, w: 5.85, h: 3.3 });
    } else if (layout === "timeline") {
      addSlideHeading(slide, title, message, palette);
      const points = bullets.length ? bullets : [message];
      slide.addShape(pptx.ShapeType.line, { x: 1.05, y: 4.25, w: 10.9, h: 0, line: { color: palette.border, width: 2 } });
      points.slice(0, 5).forEach((point, pointIndex) => {
        const x = 1.05 + pointIndex * (10.9 / Math.max(1, Math.min(points.length, 5) - 1));
        slide.addShape(pptx.ShapeType.ellipse, { x: x - 0.12, y: 4.13, w: 0.24, h: 0.24, line: { color: palette.accent }, fill: { color: palette.accent } });
        slide.addText(point, { x: Math.max(0.45, x - 0.9), y: pointIndex % 2 ? 4.55 : 3.0, w: 1.8, h: 0.85, fontSize: 11, color: palette.text, align: "center", valign: "middle", margin: 0.03, fit: "shrink" });
      });
    } else if (layout === "closing") {
      slide.addText(title, { x: 1.0, y: 1.45, w: 11.2, h: 0.85, fontSize: 30, bold: true, color: palette.text, align: "center", margin: 0.02, fit: "shrink" });
      slide.addText(message, { x: 1.45, y: 2.65, w: 10.3, h: 1.2, fontSize: 22, color: palette.accent, align: "center", valign: "middle", margin: 0.02, fit: "shrink" });
      if (bullets.length) slide.addText(bullets.join("\n"), { x: 3.0, y: 4.35, w: 7.3, h: 1.25, fontSize: 14, color: palette.muted, align: "center", breakLine: false, margin: 0.03, fit: "shrink" });
    } else {
      addSlideHeading(slide, title, message, palette);
      addBulletCard(slide, bullets, 0.82, 3.0, 11.45, 3.0, palette, pptx.ShapeType.roundRect);
    }
    const notes = text(item.speakerNotes);
    if (notes) slide.addNotes(notes);
  }
  await pptx.writeFile({ fileName: file, compression: true });
}

type Slide = ReturnType<PptxGenJS["addSlide"]>;
type Palette = ReturnType<typeof presentationPalette>;

function addSlideHeading(slide: Slide, title: string, message: string, palette: Palette): void {
  slide.addText(title, { x: 0.8, y: 0.95, w: 11.35, h: 0.62, fontSize: 24, bold: true, color: palette.text, margin: 0.02, fit: "shrink" });
  slide.addText(message, { x: 0.82, y: 1.8, w: 10.7, h: 0.72, fontSize: 16, color: palette.muted, margin: 0.02, fit: "shrink" });
}

function addBulletCard(slide: Slide, bullets: string[], x: number, y: number, w: number, h: number, palette: Palette, roundRect: PptxGenJS.ShapeType, label?: string): void {
  slide.addShape(roundRect, { x, y, w, h, rectRadius: 0.08, line: { color: palette.border, width: 1 }, fill: { color: palette.surface } });
  if (label) slide.addText(label, { x: x + 0.3, y: y + 0.25, w: 0.4, h: 0.3, fontSize: 10, bold: true, color: palette.accent, margin: 0 });
  slide.addText((bullets.length ? bullets : ["待补充要点"]).map((bullet) => ({ text: bullet, options: { bullet: { indent: 14 }, breakLine: true } })), {
    x: x + 0.35, y: y + 0.65, w: w - 0.7, h: h - 0.9, fontSize: 15, color: palette.text, breakLine: false, margin: 0.03, paraSpaceAfter: 13, valign: "middle", fit: "shrink",
  });
}

function addSlideChart(slide: Slide, bullets: string[], palette: Palette, pptx: PptxGenJS): void {
  const values = bullets.slice(0, 6).map((item, index) => {
    const match = item.match(/^(.{1,24}?)[：:]\s*(-?\d+(?:\.\d+)?)/);
    return { label: match?.[1]?.trim() || "项目 " + (index + 1), value: Math.max(0, Number(match?.[2] || (index + 1) * 10)) };
  });
  const max = Math.max(1, ...values.map((item) => item.value));
  values.forEach((item, index) => {
    const y = 3.0 + index * .5;
    const width = 8.4 * item.value / max;
    slide.addText(item.label, { x: .9, y, w: 1.8, h: .28, fontSize: 11, color: palette.muted, margin: 0, fit: "shrink" });
    slide.addShape(pptx.ShapeType.roundRect, { x: 2.8, y, w: Math.max(.08, width), h: .28, rectRadius: .04, line: { transparency: 100 }, fill: { color: index % 2 ? palette.muted : palette.accent } });
    slide.addText(String(item.value), { x: Math.min(11.5, 2.9 + width), y, w: .65, h: .28, fontSize: 10, color: palette.text, margin: 0 });
  });
}

function presentationWarnings(slides: Record<string, unknown>[]): string[] {
  const warnings: string[] = [];
  slides.forEach((slide, index) => {
    const title = text(slide.title);
    const bullets = strings(slide.bullets);
    const chars = title.length + text(slide.keyMessage).length + bullets.join("").length;
    if (title.length > 34 || bullets.length > 7 || chars > 650) warnings.push("第 " + (index + 1) + " 页内容偏多，已自动收缩；建议放映前复核。");
    if (text(slide.layout) === "visual" && !isSupportedPresentationImageData(text(slide.imageData))) warnings.push("第 " + (index + 1) + " 页选择了视觉版式，但图片格式或大小不受支持。");
  });
  return warnings;
}

export function isSupportedPresentationImageData(value: string): boolean {
  if (!value || value.length > 11_200_000) return false;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

function presentationPalette(theme: string): { background: string; surface: string; text: string; muted: string; accent: string; border: string } {
  if (theme === "ink") return { background: "111411", surface: "1B201C", text: "F3F1E8", muted: "AFB6AD", accent: "E38B45", border: "374039" };
  if (theme === "forest") return { background: "EEF1E8", surface: "F9FAF5", text: "183029", muted: "53665E", accent: "B45F35", border: "CBD4C8" };
  return { background: "F4F0E7", surface: "FFFDF8", text: "2B2925", muted: "706C64", accent: "C45F35", border: "D9D1C4" };
}

function renderWorkbench(payload: NativeCapabilityPayload, metadata?: NativeArtifactMetadata): string {
  if (payload.kind === "presentation-builder") return renderPresentation(payload, metadata);
  const content = renderWorkbenchContent(payload, metadata) + renderWorkbenchState();
  const script = workbenchScript(payload.kind);
  return pageShell(payload.title, payload.summary, content, script, payload, "workbench", metadata);
}

function renderWorkbenchState(): string {
  return '<section class="panel workbench-state"><div class="section-head"><div><p class="kicker">持续工作</p><h2>工作台状态</h2></div><label>进度 <select id="workbenchStatus"><option value="draft">整理中</option><option value="review">待复核</option><option value="done">已确认</option></select></label></div><textarea id="workbenchNotes" placeholder="补充决定、证据、风险或下一步"></textarea><div class="workbench-actions"><button id="workbenchSaveVersion" type="button">保存版本</button><select id="workbenchVersions" aria-label="历史版本"><option value="">尚未保存版本</option></select><button id="workbenchRestoreVersion" type="button">恢复所选版本</button><span id="workbenchDiff">内容会自动保存到本机。</span></div></section>';
}

function renderPresentation(payload: NativeCapabilityPayload, metadata?: NativeArtifactMetadata): string {
  const slides = records(payload.data.slides);
  const warnings = presentationWarnings(slides);
  const content = (warnings.length ? '<section class="notice"><strong>版面检查</strong><span>' + escapeHtml(warnings.join(" ")) + '</span></section>' : "") + `<main class="deck" aria-label="演示文稿">${slides.map((slide, index) => {
    const bullets = strings(slide.bullets);
    return `<article class="slide${index === 0 ? " is-active" : ""}" data-slide="${index}">
      <div class="slide-number">${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}</div>
      <p class="kicker">${escapeHtml(text(slide.layout) || "statement")}</p>
      <h1>${escapeHtml(text(slide.title))}</h1>
      <p class="slide-message">${escapeHtml(text(slide.keyMessage))}</p>
      ${bullets.length ? `<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${text(slide.speakerNotes) ? `<details><summary>演讲备注</summary><p>${escapeHtml(text(slide.speakerNotes))}</p></details>` : ""}
    </article>`;
  }).join("")}</main><nav class="deck-nav"><button id="prev" type="button">上一页</button><span id="position">1 / ${slides.length}</span><button id="next" type="button">下一页</button><button id="openDeckReview" type="button">审阅记录</button></nav>${renderPresentationReview()}`;
  const script = `let current=0;const slides=[...document.querySelectorAll('.slide')];const show=(n)=>{current=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,i)=>s.classList.toggle('is-active',i===current));document.getElementById('position').textContent=(current+1)+' / '+slides.length;};const requested=Number(new URLSearchParams(location.search).get('slide'));show(Number.isInteger(requested)?requested:0);document.getElementById('prev').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);addEventListener('keydown',e=>{if(document.getElementById('deckReviewDialog')?.open)return;if(e.key==='ArrowLeft')show(current-1);if(e.key==='ArrowRight'||e.key===' ')show(current+1);});document.getElementById('openDeckReview').onclick=()=>document.getElementById('deckReviewDialog').showModal();document.getElementById('closeDeckReview').onclick=()=>document.getElementById('deckReviewDialog').close();` + workbenchScript("presentation-builder");
  return pageShell(payload.title, payload.summary, content, script, payload, "presentation", metadata);
}

function renderPresentationReview(): string {
  return `<dialog class="deck-review" id="deckReviewDialog"><section class="panel workbench-state"><div class="section-head"><div><p class="kicker">审阅记录</p><h2>这份演示是否可以交付</h2></div><label>进度 <select id="workbenchStatus"><option value="draft">整理中</option><option value="review">待复核</option><option value="done">已确认</option></select></label></div><textarea id="workbenchNotes" placeholder="记录需要调整的页面、讲述重点或最终决定"></textarea><div class="workbench-actions"><button id="workbenchSaveVersion" type="button">保存审阅版本</button><select id="workbenchVersions" aria-label="历史版本"><option value="">尚未保存版本</option></select><button id="workbenchRestoreVersion" type="button">恢复所选版本</button><button id="closeDeckReview" type="button">关闭</button><span id="workbenchDiff">内容会自动保存到本机。</span></div></section></dialog>`;
}

function renderWorkbenchContent(payload: NativeCapabilityPayload, metadata?: NativeArtifactMetadata): string {
  switch (payload.kind) {
    case "research-brief":
      return renderResearch(payload);
    case "thinking-workbench":
      return renderThinking(payload);
    case "product-design":
      return renderProduct(payload);
    case "business-deal":
      return renderBusiness(payload);
    case "market-opportunity":
      return renderMarket(payload);
    case "ability-builder":
      return renderAbility(payload, metadata);
    case "presentation-builder":
      return "";
  }
}

function renderResearch(payload: NativeCapabilityPayload): string {
  const data = payload.data;
  const sources = records(data.sources);
  const findings = records(data.findings);
  const anchors = sources.flatMap((source) => records(source.anchors).map((anchor) => ({ anchor, source })));
  const chart = svgChart("结论置信度", findings.map((item) => text(item.claim).slice(0, 12)), findings.map((item) => Math.round(number(item.confidence) * 100)), "bar");
  return `${heroBlock("研究问题", text(data.question), ["分阶段研究", "来源分级", "结论核验"])}
    <section class="panel"><h2>研究路径</h2>${ordered(strings(data.plan))}</section>
    <section class="panel"><div class="section-head"><h2>关键结论</h2><span>${findings.length} 条</span></div><div class="card-grid">${findings.map((item) => `<article class="finding"><span class="status ${escapeHtml(text(item.status))}">${statusLabel(text(item.status))}</span><h3>${escapeHtml(text(item.claim))}</h3><p>置信度 ${Math.round(number(item.confidence) * 100)}% · 来源 ${strings(item.evidenceIds).map(escapeHtml).join("、") || "待补充"}</p><p class="anchor-links">${strings(item.anchorIds).map((id) => `<a href="#evidence-${escapeAttribute(id)}">${escapeHtml(id)}</a>`).join(" ") || "没有可定位证据"}</p></article>`).join("")}</div></section>
    <section class="panel"><div class="section-head"><h2>来源台账</h2><span>${sources.length} 个来源</span></div><div class="table-wrap"><table><thead><tr><th>来源</th><th>等级</th><th>评分</th><th>核验时间</th></tr></thead><tbody>${sources.map((source) => `<tr><td>${sourceLink(source)}</td><td>Tier ${escapeHtml(String(source.tier || "-"))}</td><td>${escapeHtml(String(source.score ?? "-"))}</td><td>${escapeHtml(text(source.checkedAt) || "待确认")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><div class="section-head"><h2>证据定位</h2><span>${anchors.length} 个锚点</span></div>${anchors.map(({ source, anchor }) => `<article class="evidence-anchor" id="evidence-${escapeAttribute(text(anchor.id))}"><h3>${escapeHtml(text(anchor.id))} · ${escapeHtml(text(source.title) || text(source.publisher))}</h3><p>${escapeHtml(text(anchor.page) || text(anchor.span))}</p><blockquote>${escapeHtml(text(anchor.quote))}</blockquote><small>SHA-256 ${escapeHtml(text(anchor.quoteHash).slice(0, 16))}…</small></article>`).join("") || "<p>暂无可定位证据，相关结论不能标为已核验。</p>"}</section>
    ${textBlock("结论", text(data.conclusion))}${chart}${listBlock("限制与待确认", strings(data.limitations))}${listBlock("下一步", strings(data.nextSteps))}`;
}

function renderThinking(payload: NativeCapabilityPayload): string {
  const data = payload.data;
  const options = records(data.options);
  const experiments = records(data.experiments);
  return `${heroBlock("当前问题", text(data.problem), ["事实与假设分开", "保留多种解释", "先做低成本验证"])}
    <div class="split"><section class="panel"><h2>已知事实</h2>${checkList(strings(data.facts), "fact")}</section><section class="panel"><h2>关键假设</h2>${records(data.assumptions).map((item, index) => `<label class="check-row"><input type="checkbox" data-check="assumption-${index}"><span><strong>${escapeHtml(text(item.text))}</strong><small>风险：${escapeHtml(text(item.risk) || "待评估")}</small></span></label>`).join("")}</section></div>
    ${listBlock("矛盾与张力", strings(data.contradictions))}
    <section class="panel"><h2>可选方向</h2><div class="card-grid">${options.map((item) => `<article><h3>${escapeHtml(text(item.name))}</h3><p><b>收益</b> ${escapeHtml(text(item.upside))}</p><p><b>代价</b> ${escapeHtml(text(item.downside))}</p><p><b>判断信号</b> ${escapeHtml(text(item.signal))}</p></article>`).join("")}</div></section>
    <section class="panel"><h2>低成本验证</h2>${experiments.map((item, index) => `<label class="check-row"><input type="checkbox" data-check="experiment-${index}"><span><strong>${escapeHtml(text(item.name))}</strong><small>${escapeHtml(text(item.method))} · 成本 ${escapeHtml(text(item.cost))} · 成功信号 ${escapeHtml(text(item.successSignal))}</small></span></label>`).join("")}</section>
    ${listBlock("下一步", strings(data.nextActions))}<section class="panel"><h2>我的补充</h2><textarea id="workNotes" placeholder="记录新的证据、反例或决定"></textarea><p class="save-hint">内容只保存在当前浏览器。</p></section>`;
}

function renderProduct(payload: NativeCapabilityPayload): string {
  const data = payload.data;
  const screens = records(data.screens);
  return `${heroBlock("用户任务", text(data.job), [text(data.user), `${screens.length} 个关键界面`, "含状态与验收"])}
    <section class="panel"><h2>成功标准</h2>${checkList(strings(data.successCriteria), "success")}</section>
    <section class="panel"><h2>完整流程</h2><div class="timeline">${records(data.flow).map((item, index) => `<article><span>${index + 1}</span><div><h3>${escapeHtml(text(item.step))}</h3><p>用户：${escapeHtml(text(item.userAction))}</p><small>系统：${escapeHtml(text(item.systemResponse))}</small></div></article>`).join("")}</div></section>
    <section class="panel"><div class="section-head"><h2>关键界面</h2><div class="screen-tabs">${screens.map((screen, index) => `<button type="button" data-screen-tab="${index}" class="${index === 0 ? "is-active" : ""}">${escapeHtml(text(screen.name))}</button>`).join("")}</div></div>${screens.map((screen, index) => `<article class="screen-preview ${index === 0 ? "is-active" : ""}" data-screen="${index}"><div class="screen-top"><span></span><span></span><span></span></div><div class="screen-body"><p class="kicker">${escapeHtml(text(screen.purpose))}</p><h3>${escapeHtml(text(screen.name))}</h3><button type="button">${escapeHtml(text(screen.primaryAction) || "主要操作")}</button><div class="mock-sections">${strings(screen.sections).map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div><p class="state-line">状态：${strings(screen.states).map(escapeHtml).join(" / ")}</p></div></article>`).join("")}</section>
    ${listBlock("信息结构", strings(data.informationArchitecture))}${listBlock("验收检查", strings(data.acceptanceChecks))}`;
}

function renderBusiness(payload: NativeCapabilityPayload): string {
  const data = payload.data;
  return `${heroBlock("合作推进", text(data.mutualValue), ["事实与假设分开", "谈判边界清楚", "行动可跟踪"])}${textBlock("客户与机会背景", text(data.accountContext))}
    <section class="panel"><h2>关键人</h2><div class="table-wrap"><table><thead><tr><th>人物</th><th>角色</th><th>影响力</th><th>兴趣</th><th>状态</th></tr></thead><tbody>${records(data.stakeholders).map((item) => `<tr><td>${escapeHtml(text(item.name))}</td><td>${escapeHtml(text(item.role))}</td><td>${escapeHtml(text(item.influence))}</td><td>${escapeHtml(text(item.interest))}</td><td>${escapeHtml(text(item.status))}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><h2>异议处理</h2><div class="card-grid">${records(data.objections).map((item) => `<article><h3>${escapeHtml(text(item.objection))}</h3><p>${escapeHtml(text(item.response))}</p><small>仍需证据：${escapeHtml(text(item.evidenceNeeded) || "无")}</small></article>`).join("")}</div></section>
    ${listBlock("已有证据", strings(data.evidence))}${listBlock("待验证假设", strings(data.assumptions))}${listBlock("谈判边界", strings(data.boundaries))}${listBlock("会面议程", strings(data.agenda))}
    <section class="panel"><h2>跟进话术</h2>${records(data.followUps).map((item) => `<article class="message-card"><small>${escapeHtml(text(item.channel))}</small><p>${escapeHtml(text(item.message))}</p><button type="button" data-copy="${escapeAttribute(text(item.message))}">复制</button></article>`).join("")}</section>${listBlock("下一步", strings(data.nextActions))}`;
}

function renderMarket(payload: NativeCapabilityPayload): string {
  const data = payload.data;
  const scenarios = records(data.scenarios);
  const chart = svgChart("情景基准分", scenarios.map((item) => text(item.name)), scenarios.map((item) => Math.round((number(item.demandScore) + number(item.executionScore) + (100 - number(item.competitionScore))) / 3)), "line");
  return `${heroBlock("机会假设", text(data.thesis), [text(data.targetUser), "三情景模拟", "含失效条件"])}${textBlock("需要解决的问题", text(data.problem))}
    <section class="panel"><h2>情景权重</h2><div class="weights"><label>需求 <input id="demandWeight" type="range" min="0" max="100" value="45"><span>45%</span></label><label>执行 <input id="executionWeight" type="range" min="0" max="100" value="35"><span>35%</span></label><label>竞争压力 <input id="competitionWeight" type="range" min="0" max="100" value="20"><span>20%</span></label></div><div class="scenario-grid">${scenarios.map((item, index) => `<article data-scenario="${index}" data-demand="${number(item.demandScore)}" data-execution="${number(item.executionScore)}" data-competition="${number(item.competitionScore)}"><div class="score-ring"><strong>0</strong><small>综合</small></div><h3>${escapeHtml(text(item.name))}</h3><p>${escapeHtml(text(item.description))}</p><div class="metric"><span>需求 ${number(item.demandScore)}</span><span>执行 ${number(item.executionScore)}</span><span>竞争 ${number(item.competitionScore)}</span></div></article>`).join("")}</div></section>
    <section class="panel"><h2>核心假设</h2><div class="table-wrap"><table><thead><tr><th>变量</th><th>低</th><th>基准</th><th>高</th><th>单位</th></tr></thead><tbody>${records(data.assumptions).map((item) => `<tr><td>${escapeHtml(text(item.name))}</td><td>${escapeHtml(String(item.low ?? ""))}</td><td>${escapeHtml(String(item.base ?? ""))}</td><td>${escapeHtml(String(item.high ?? ""))}</td><td>${escapeHtml(text(item.unit))}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><h2>模型边界</h2><p><strong>版本：</strong>${escapeHtml(text(data.modelVersion))}</p>${unordered(strings(data.applicability))}</section>
    <section class="panel"><h2>证据与冲突</h2><div class="card-grid">${records(data.evidence).map((item) => `<article><h3>${escapeHtml(text(item.id))}</h3><p>${escapeHtml(text(item.claim))}</p><small>${escapeHtml(text(item.source))} · ${escapeHtml(text(item.checkedAt))}</small></article>`).join("")}</div>${listBlock("相互冲突的信息", strings(data.conflicts))}</section>
    ${chart}${listBlock("当前替代方案", strings(data.alternatives))}${listBlock("失效条件", strings(data.invalidation))}<section class="panel"><h2>验证实验</h2>${records(data.experiments).map((item) => `<article class="experiment"><h3>${escapeHtml(text(item.name))}</h3><p>成本 ${escapeHtml(text(item.cost))} · 周期 ${escapeHtml(text(item.duration))}</p><small>成功信号：${escapeHtml(text(item.successSignal))}</small></article>`).join("")}</section>${listBlock("主要风险", strings(data.risks))}`;
}

function svgChart(title: string, labels: string[], values: number[], type: "bar" | "line" | "donut"): string {
  const pairs = labels.map((label, index) => ({ label: label || "项目 " + (index + 1), value: Math.max(0, Math.min(100, Number(values[index]) || 0)) })).slice(0, 8);
  if (!pairs.length) return "";
  const width = 760;
  const height = 280;
  let marks = "";
  if (type === "donut") {
    const total = pairs.reduce((sum, item) => sum + item.value, 0) || 1;
    let offset = 0;
    const circles = pairs.map((item, index) => {
      const length = item.value / total * 251.2;
      const circle = '<circle cx="150" cy="140" r="40" fill="none" stroke="' + chartColor(index) + '" stroke-width="24" stroke-dasharray="' + length + ' ' + (251.2 - length) + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 150 140)"/>';
      offset += length;
      return circle;
    }).join("");
    marks = circles + pairs.map((item, index) => '<text x="250" y="' + (70 + index * 25) + '" fill="#5f625b" font-size="13"><tspan fill="' + chartColor(index) + '">■</tspan> ' + escapeHtml(item.label) + ' ' + item.value + '</text>').join("");
  } else if (type === "line") {
    const points = pairs.map((item, index) => {
      const x = 55 + index * (650 / Math.max(1, pairs.length - 1));
      const y = 225 - item.value * 1.65;
      return { ...item, x, y };
    });
    marks = '<polyline fill="none" stroke="#b85c38" stroke-width="4" points="' + points.map((item) => item.x + "," + item.y).join(" ") + '"/>' + points.map((item) => '<circle cx="' + item.x + '" cy="' + item.y + '" r="5" fill="#b85c38"/><text x="' + item.x + '" y="252" text-anchor="middle" fill="#716c63" font-size="11">' + escapeHtml(item.label.slice(0, 8)) + '</text><text x="' + item.x + '" y="' + (item.y - 10) + '" text-anchor="middle" fill="#292823" font-size="11">' + item.value + '</text>').join("");
  } else {
    const gap = 650 / pairs.length;
    marks = pairs.map((item, index) => {
      const barHeight = item.value * 1.65;
      const x = 55 + index * gap + gap * .15;
      const w = gap * .7;
      return '<rect x="' + x + '" y="' + (225 - barHeight) + '" width="' + w + '" height="' + barHeight + '" rx="5" fill="' + chartColor(index) + '"/><text x="' + (x + w / 2) + '" y="252" text-anchor="middle" fill="#716c63" font-size="11">' + escapeHtml(item.label.slice(0, 8)) + '</text><text x="' + (x + w / 2) + '" y="' + (215 - barHeight) + '" text-anchor="middle" fill="#292823" font-size="11">' + item.value + '</text>';
    }).join("");
  }
  return '<section class="panel chart-panel"><h2>' + escapeHtml(title) + '</h2><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeAttribute(title) + '">' + marks + '</svg></section>';
}

function chartColor(index: number): string {
  return ["#b85c38", "#326a53", "#446b8c", "#9a5a22", "#76508f", "#4f7c72", "#a74861", "#687078"][index % 8]!;
}

function renderAbility(payload: NativeCapabilityPayload, metadata?: NativeArtifactMetadata): string {
  const data = payload.data;
  const qualification = record(data.qualification);
  const spec = record(data.spec);
  const installed = metadata?.generatedAbilityId;
  return `${heroBlock(qualification.shouldBuild === true ? "适合沉淀为能力" : "暂不建议沉淀", text(qualification.reason), [text(spec.name), strings(spec.triggerExamples).length + " 个触发例", strings(data.testCases).length + " 个测试"])}
    ${installed ? `<section class="notice success"><strong>已加入小丑鱼能力库</strong><span>能力编号 ${escapeHtml(installed)}</span></section>` : `<section class="notice"><strong>尚未加入能力库</strong><span>资格检查未通过或未完成安装。</span></section>`}
    <section class="panel"><h2>能力定义</h2><dl class="definition"><div><dt>名称</dt><dd>${escapeHtml(text(spec.name))}</dd></div><div><dt>用途</dt><dd>${escapeHtml(text(spec.description))}</dd></div><div><dt>默认结果</dt><dd>${escapeHtml(text(spec.defaultFormat))}</dd></div></dl></section>
    <div class="split"><section class="panel"><h2>应该触发</h2>${unordered(strings(spec.triggerExamples))}</section><section class="panel"><h2>不应该触发</h2>${unordered(strings(spec.nonTriggerExamples))}</section></div>
    ${listBlock("所需输入", strings(spec.inputs))}${listBlock("执行步骤", strings(spec.steps), true)}${listBlock("判断规则", strings(spec.decisionRules))}${listBlock("结果约定", strings(spec.outputs))}${listBlock("异常路径", strings(spec.exceptions))}${listBlock("验收检查", strings(spec.checks))}
    <section class="panel"><h2>触发测试</h2><div class="table-wrap"><table><thead><tr><th>请求</th><th>预期</th><th>原因</th></tr></thead><tbody>${records(data.testCases).map((item) => `<tr><td>${escapeHtml(text(item.request))}</td><td>${item.shouldTrigger === true ? "触发" : "不触发"}</td><td>${escapeHtml(text(item.reason))}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function pageShell(title: string, summary: string, content: string, script: string, payload: NativeCapabilityPayload, mode = "workbench", metadata?: NativeArtifactMetadata): string {
  const safeJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const artifactId = escapeAttribute(metadata?.artifactId || "");
  const workspaceScript = artifactId ? '<script src="/assets/artifact-workspace.js"></script>' : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${artifactCss()}</style></head><body class="${mode}" data-artifact-id="${artifactId}"><header class="artifact-header"><div><span class="brand-mark">鱼</span><span>小丑鱼能力结果</span></div><button type="button" id="printButton">打印 / 导出 PDF</button></header><div class="artifact-wrap"><header class="title-block"><p>已完成</p><h1>${escapeHtml(title)}</h1><span>${escapeHtml(summary)}</span></header>${content}<footer>由小丑鱼在本机生成 · 具体要求优先于记忆偏好</footer></div><script type="application/json" id="artifactData">${safeJson}</script><script>document.getElementById('printButton').onclick=()=>print();${script}</script>${workspaceScript}</body></html>`;
}

function workbenchScript(kind: NativeCapabilityId): string {
  const common = 'document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(b.dataset.copy||"");const old=b.textContent;b.textContent="已复制";setTimeout(()=>b.textContent=old,1200);});';
  const product = 'const tabs=[...document.querySelectorAll("[data-screen-tab]")];const screens=[...document.querySelectorAll("[data-screen]")];tabs.forEach((tab,i)=>tab.onclick=()=>{tabs.forEach((x,n)=>x.classList.toggle("is-active",n===i));screens.forEach((x,n)=>x.classList.toggle("is-active",n===i));});';
  const market = 'const inputs=[...document.querySelectorAll(".weights input")];function update(){const d=+document.getElementById("demandWeight").value/100,e=+document.getElementById("executionWeight").value/100,c=+document.getElementById("competitionWeight").value/100;inputs.forEach(x=>x.nextElementSibling.textContent=x.value+"%");document.querySelectorAll("[data-scenario]").forEach(x=>{const score=Math.max(0,Math.min(100,Math.round(+x.dataset.demand*d + +x.dataset.execution*e + (100- +x.dataset.competition)*c)));x.querySelector(".score-ring strong").textContent=score;});}inputs.forEach(x=>x.addEventListener("input",update));update();';
  return common + (kind === "product-design" ? product : "") + (kind === "market-opportunity" ? market : "");
}

export function renderNativeCapabilityMarkdown(payload: NativeCapabilityPayload): string {
  const lines = [`# ${payload.title}`, "", payload.summary, "", `> 能力：${payload.kind}`, ""];
  for (const [key, value] of Object.entries(payload.data)) {
    lines.push(`## ${labelFor(key)}`, "", markdownValue(value), "");
  }
  return lines.join("\n").trim() + "\n";
}

function markdownValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? `- ${Object.entries(record(item)).map(([k, v]) => `${labelFor(k)}：${flat(v)}`).join("；")}` : `- ${String(item)}`).join("\n") || "（无）";
  if (value && typeof value === "object") return Object.entries(record(value)).map(([key, item]) => `- **${labelFor(key)}**：${flat(item)}`).join("\n");
  return "（无）";
}

function flat(value: unknown): string {
  if (Array.isArray(value)) return value.map(flat).join("、");
  if (value && typeof value === "object") return Object.values(record(value)).map(flat).join("；");
  return String(value ?? "");
}

function artifactCss(): string {
  return `:root{--bg:#f2eee5;--surface:#fffdf8;--text:#292823;--muted:#716c63;--line:#d9d0c3;--accent:#b85c38;--accent-soft:#f3dfd4;--ok:#326a53;--warn:#9a5a22;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:var(--text);background:var(--bg)}*{box-sizing:border-box}body{margin:0;line-height:1.65}.artifact-header{height:58px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(242,238,229,.92);position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}.artifact-header>div{display:flex;gap:10px;align-items:center;font-size:13px;letter-spacing:.02em}.brand-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--text);color:#fff}.artifact-header button,.deck-nav button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:8px 14px;color:var(--text);cursor:pointer}.artifact-wrap{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:64px 0}.title-block{max-width:850px;margin-bottom:48px}.title-block>p,.kicker{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);font-weight:700}.title-block h1{font-family:Georgia,"Songti SC",serif;font-size:clamp(36px,6vw,72px);line-height:1.04;letter-spacing:-.03em;margin:12px 0}.title-block>span{display:block;max-width:68ch;color:var(--muted);font-size:17px}.hero-card{padding:36px;border-radius:22px;background:var(--text);color:#f8f5ed;margin-bottom:24px}.hero-card p{color:#c8c3b8}.tag-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.tag-row span{border:1px solid #5b584f;border-radius:999px;padding:6px 11px;font-size:12px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:26px;margin:18px 0;box-shadow:0 14px 40px rgba(54,45,33,.04)}.panel h2{font-family:Georgia,"Songti SC",serif;margin:0 0 18px;font-size:24px}.panel h3{margin:0 0 8px}.panel p{color:var(--muted)}.section-head{display:flex;justify-content:space-between;gap:16px;align-items:center}.section-head>span{font-size:12px;color:var(--muted)}.card-grid,.scenario-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card-grid article,.scenario-grid article,.finding{border:1px solid var(--line);border-radius:14px;padding:18px;background:#fff}.split{display:grid;grid-template-columns:1fr 1fr;gap:18px}.status{display:inline-block;font-size:11px;border-radius:999px;padding:4px 8px;background:#eee}.status.confirmed{background:#dcebe3;color:var(--ok)}.status.partial{background:#f3e7d7;color:var(--warn)}.status.unverified{background:#eee5df;color:#794837}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}a{color:var(--accent)}ol,ul{padding-left:22px}.check-row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.check-row input{width:18px;height:18px;margin-top:3px;accent-color:var(--accent)}.check-row span{display:grid}.check-row small,.save-hint{color:var(--muted)}textarea{width:100%;min-height:140px;border:1px solid var(--line);border-radius:12px;padding:14px;font:inherit;background:#fff}.timeline{display:grid;gap:14px}.timeline article{display:flex;gap:14px}.timeline article>span{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-weight:700}.timeline h3,.timeline p{margin:0}.screen-tabs{display:flex;gap:8px;flex-wrap:wrap}.screen-tabs button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 12px}.screen-tabs button.is-active{background:var(--text);color:#fff}.screen-preview{display:none;max-width:780px;margin:22px auto;border:1px solid #bdb5a8;border-radius:16px;overflow:hidden;background:#f7f5ef;box-shadow:0 28px 70px rgba(43,40,35,.15)}.screen-preview.is-active{display:block}.screen-top{height:38px;background:#e7e1d7;display:flex;align-items:center;gap:6px;padding:0 14px}.screen-top span{width:8px;height:8px;border-radius:50%;background:#c5b9aa}.screen-body{padding:36px}.screen-body>button{border:0;border-radius:10px;background:var(--accent);color:white;padding:11px 16px}.mock-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:24px 0}.mock-sections div{min-height:74px;border:1px solid var(--line);border-radius:10px;padding:12px;background:white}.state-line{font-size:12px}.message-card{position:relative;border-left:3px solid var(--accent);padding:12px 80px 12px 16px;margin:12px 0;background:#faf7f1}.message-card button{position:absolute;right:12px;top:12px}.notice{display:flex;justify-content:space-between;padding:14px 18px;border-radius:12px;background:#eee5df;margin:18px 0}.notice.success{background:#dcebe3;color:var(--ok)}.definition div{display:grid;grid-template-columns:140px 1fr;padding:10px 0;border-bottom:1px solid var(--line)}.definition dt{color:var(--muted)}.definition dd{margin:0}.weights{display:grid;gap:10px;margin-bottom:20px}.weights label{display:grid;grid-template-columns:90px 1fr 48px;gap:12px;align-items:center}.weights input{accent-color:var(--accent)}.scenario-grid article{display:grid;grid-template-columns:68px 1fr;column-gap:14px}.scenario-grid article>p,.scenario-grid .metric{grid-column:1/-1}.score-ring{width:64px;height:64px;border-radius:50%;background:var(--text);color:white;display:grid;place-items:center;align-content:center}.score-ring strong{font-size:22px;line-height:1}.score-ring small{font-size:9px}.metric{display:flex;gap:8px;flex-wrap:wrap}.metric span{font-size:11px;border-radius:999px;background:var(--accent-soft);padding:4px 8px}.experiment{border-bottom:1px solid var(--line);padding:14px 0}.experiment p{margin:4px 0}.workbench-state label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.workbench-state select,.workbench-actions button,.workbench-actions select{min-height:34px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:0 10px}.workbench-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.workbench-actions span{color:var(--muted);font-size:11px}.chart-panel svg{width:100%;height:auto;display:block;overflow:visible}.deck .artifact-wrap{padding-top:20px}.deck{min-height:calc(100vh - 140px);display:grid;place-items:center}.slide{display:none;width:min(1180px,calc(100vw - 48px));aspect-ratio:16/9;padding:clamp(32px,6vw,86px);background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 32px 90px rgba(43,40,35,.16);position:relative;overflow:auto}.slide.is-active{display:block}.slide-number{position:absolute;right:28px;top:24px;color:var(--muted);font-size:12px}.slide h1{font-family:Georgia,"Songti SC",serif;font-size:clamp(32px,5vw,64px);line-height:1.08;margin:12px 0}.slide-message{font-size:clamp(18px,2.3vw,28px);max-width:40ch;color:var(--accent)}.slide li{font-size:clamp(15px,1.6vw,21px);margin:10px 0}.deck-nav{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:16px;align-items:center;padding:8px;border:1px solid var(--line);background:rgba(255,253,248,.94);border-radius:999px;box-shadow:0 10px 30px rgba(43,40,35,.12)}.deck-review{width:min(720px,calc(100% - 32px));border:0;border-radius:20px;padding:0;background:transparent}.deck-review::backdrop{background:rgba(35,31,27,.46);backdrop-filter:blur(4px)}.deck-review .panel{margin:0;box-shadow:0 30px 90px rgba(30,25,20,.25)}footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:720px){.artifact-header{padding:0 14px}.artifact-wrap{padding:36px 0}.split{grid-template-columns:1fr}.panel,.hero-card{padding:20px}.section-head{align-items:flex-start;flex-direction:column}.definition div{grid-template-columns:1fr}.slide{aspect-ratio:auto;min-height:calc(100vh - 150px)}}@media print{.artifact-header,.deck-nav{display:none}.artifact-wrap{width:100%;padding:0}.panel,.hero-card,.slide{break-inside:avoid;box-shadow:none}.slide{display:block!important;page-break-after:always;width:100%;aspect-ratio:16/9;border:0;border-radius:0}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}`;
}

function heroBlock(kicker: string, content: string, tags: string[]): string {
  return `<section class="hero-card"><span class="kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(content)}</h2><div class="tag-row">${tags.filter(Boolean).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>`;
}

function textBlock(title: string, content: string): string {
  return content ? `<section class="panel"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(content)}</p></section>` : "";
}

function listBlock(title: string, items: string[], orderedList = false): string {
  if (!items.length) return "";
  return `<section class="panel"><h2>${escapeHtml(title)}</h2>${orderedList ? ordered(items) : unordered(items)}</section>`;
}

function ordered(items: string[]): string {
  return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

function unordered(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function checkList(items: string[], prefix: string): string {
  return items.map((item, index) => `<label class="check-row"><input type="checkbox" data-check="${prefix}-${index}"><span>${escapeHtml(item)}</span></label>`).join("") || "<p>暂无项目</p>";
}

function sourceLink(source: Record<string, unknown>): string {
  const title = escapeHtml(text(source.title) || text(source.publisher) || "未命名来源");
  const url = text(source.url);
  return /^https?:\/\//i.test(url) ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
}

function statusLabel(status: string): string {
  if (status === "confirmed") return "已核验";
  if (status === "partial") return "部分核验";
  return "待核验";
}

function labelFor(key: string): string {
  const labels: Record<string, string> = { question: "研究问题", plan: "研究路径", sources: "来源", findings: "发现", conclusion: "结论", limitations: "限制", nextSteps: "下一步", audience: "受众", purpose: "目标", slides: "页面", problem: "问题", facts: "事实", assumptions: "假设", options: "选项", experiments: "实验", nextActions: "下一步", user: "用户", job: "用户任务", flow: "流程", screens: "界面", acceptanceChecks: "验收检查", stakeholders: "关键人", objections: "异议", boundaries: "边界", scenarios: "情景", thesis: "机会假设", invalidation: "失效条件", qualification: "资格判断", spec: "能力定义", testCases: "触发测试" };
  return labels[key] || key;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
