"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findChartWorkbookPath = findChartWorkbookPath;
exports.readDocxPartBase64 = readDocxPartBase64;
exports.saveDocx = saveDocx;
const jszip_1 = __importDefault(require("jszip"));
const generate_1 = require("./generate");
const notes_1 = require("./notes");
const ink_1 = require("./ink");
const parse_1 = require("./parse");
const blank_1 = require("./blank");
const section_1 = require("./section");
const sources_1 = require("./sources");
const theme_1 = require("./theme");
const chart_1 = require("./chart");
const types_1 = require("./types");
const text_patch_1 = require("./text-patch");
const watermark_1 = require("./watermark");
const xml_utils_1 = require("./xml-utils");
const HYPERLINK_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HF_REL_TYPE = {
    header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
    footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
};
function buildStyleXml(up) {
    const rPr = [];
    if (up.rPr?.font) {
        const f = (0, xml_utils_1.escapeXmlAttr)(up.rPr.font);
        rPr.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}"/>`);
    }
    if (up.rPr?.bold)
        rPr.push('<w:b/>');
    if (up.rPr?.italic)
        rPr.push('<w:i/>');
    if (up.rPr?.strike)
        rPr.push('<w:strike/>');
    if (up.rPr?.color)
        rPr.push(`<w:color w:val="${(0, xml_utils_1.escapeXmlAttr)(up.rPr.color)}"/>`);
    if (up.rPr?.sizeHalfPoints) {
        rPr.push(`<w:sz w:val="${up.rPr.sizeHalfPoints}"/><w:szCs w:val="${up.rPr.sizeHalfPoints}"/>`);
    }
    if (up.rPr?.underline)
        rPr.push('<w:u w:val="single"/>');
    const pPr = [];
    const sp = up.pPr;
    if (sp &&
        (sp.spaceBeforeTwips !== undefined ||
            sp.spaceAfterTwips !== undefined ||
            sp.lineSpacing !== undefined)) {
        const attrs = [
            sp.spaceBeforeTwips !== undefined ? ` w:before="${sp.spaceBeforeTwips}"` : '',
            sp.spaceAfterTwips !== undefined ? ` w:after="${sp.spaceAfterTwips}"` : '',
            sp.lineSpacing !== undefined
                ? ` w:line="${Math.round(sp.lineSpacing * 240)}" w:lineRule="auto"`
                : '',
        ].join('');
        pPr.push(`<w:spacing${attrs}/>`);
    }
    if (sp?.align)
        pPr.push(`<w:jc w:val="${sp.align === 'justify' ? 'both' : sp.align}"/>`);
    return (`<w:style w:type="${up.type}" w:styleId="${(0, xml_utils_1.escapeXmlAttr)(up.styleId)}" w:customStyle="1">` +
        `<w:name w:val="${(0, xml_utils_1.escapeXmlAttr)(up.name)}"/>` +
        (up.basedOn ? `<w:basedOn w:val="${(0, xml_utils_1.escapeXmlAttr)(up.basedOn)}"/>` : '') +
        '<w:qFormat/>' +
        (pPr.length > 0 ? `<w:pPr>${pPr.join('')}</w:pPr>` : '') +
        (rPr.length > 0 ? `<w:rPr>${rPr.join('')}</w:rPr>` : '') +
        '</w:style>');
}
const NUMBERING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const COMMENTS_EXT_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const COMMENTS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const SETTINGS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const CHART_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IMAGE_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
};
const EMU_PER_PX = 9525;
/**
 * Given the original docx bytes and a chart part path (e.g.
 * "word/charts/chart1.xml"), returns the zip-relative path of the embedded
 * workbook (e.g. "word/charts/embeddings/workbook1.xlsx") by reading the
 * chart's rels file, or null when no workbook relationship exists.
 */
async function findChartWorkbookPath(docxBytes, chartPath) {
    try {
        const zip = await jszip_1.default.loadAsync(docxBytes);
        // chart path: word/charts/chart1.xml → rels: word/charts/_rels/chart1.xml.rels
        const dir = chartPath.substring(0, chartPath.lastIndexOf('/'));
        const file = chartPath.substring(chartPath.lastIndexOf('/') + 1);
        const relsPath = `${dir}/_rels/${file}.rels`;
        const relsFile = zip.file(relsPath);
        if (!relsFile)
            return null;
        const relsXml = await relsFile.async('text');
        // find Relationship with Type ending in /package
        const m = relsXml.match(/Type="[^"]*\/package"[^/]*Target="([^"]+)"/);
        if (!m)
            return null;
        // Target is relative to dir (word/charts/)
        const target = m[1];
        if (target.startsWith('/'))
            return target.slice(1);
        return `${dir}/${target}`;
    }
    catch {
        return null;
    }
}
/**
 * Read the raw base64 bytes of a zip part from a docx file.
 * Returns null if the part doesn't exist.
 */
async function readDocxPartBase64(docxBytes, path) {
    try {
        const zip = await jszip_1.default.loadAsync(docxBytes);
        const file = zip.file(path);
        if (!file)
            return null;
        const bytes = await file.async('uint8array');
        let binary = '';
        for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    catch {
        return null;
    }
}
const CORE_PROPS_PATH = 'docProps/core.xml';
/**
 * docProps/core.xml: only a real save to disk updates dcterms:modified and cp:revision;
 * all other fields stay as-is. Missing tags are not injected (avoids touching the root
 * element namespaces); returns null = no change.
 */
function patchCoreProps(xml, savedAt) {
    const iso = (savedAt ?? new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z');
    let out = xml.replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${iso}$2`);
    out = out.replace(/(<cp:revision>)(\d+)(<\/cp:revision>)/, (_m, open, n, close) => {
        const next = parseInt(n, 10) + 1;
        return Number.isFinite(next) ? `${open}${next}${close}` : `${open}${n}${close}`;
    });
    return out === xml ? null : out;
}
/**
 * Paragraph-patch save.
 *
 * - Blocks marked 'original' are copied as the exact substring of the original
 *   word/document.xml (byte-for-byte after UTF-8 re-encode).
 * - Blocks marked 'generated' become fresh OOXML fragments referencing only
 *   styles that already exist in the document.
 * - 'xml' blocks are self-contained fragments inserted verbatim; 'image' blocks
 *   additionally add media entries and relationships.
 * - Every other zip entry is copied without modification.
 * - If nothing changed at all, the original file bytes are returned untouched.
 */
async function saveDocx(parsed, finalBlocks, options = {}) {
    const { documentXml, originalBytes, bodyInnerStart, bodyInnerEnd } = parsed.internal;
    const elements = parsed.extras.elements;
    const visibleOriginalOrder = parsed.blocks.filter((b) => !b.hidden).map((b) => b.docxIndex);
    const isUnchanged = finalBlocks.length === visibleOriginalOrder.length &&
        finalBlocks.every((fb, i) => fb.kind === 'original' &&
            fb.docxIndex === visibleOriginalOrder[i] &&
            fb.revision === undefined) &&
        options.section === undefined &&
        options.sectionStartType === undefined &&
        options.pgNumType === undefined &&
        options.pageColor === undefined &&
        options.header === undefined &&
        options.footer === undefined &&
        options.headerFirst === undefined &&
        options.footerFirst === undefined &&
        options.headerEven === undefined &&
        options.footerEven === undefined &&
        options.titlePg === undefined &&
        (options.sectionHf === undefined || options.sectionHf.length === 0) &&
        options.numbering === undefined &&
        (options.styleUpserts === undefined || options.styleUpserts.length === 0) &&
        options.evenAndOddHeaders === undefined &&
        options.comments === undefined &&
        options.protection === undefined &&
        options.footnotes === undefined &&
        options.endnotes === undefined &&
        options.watermark === undefined &&
        options.inks === undefined &&
        options.sources === undefined &&
        options.themeFonts === undefined &&
        options.themeColors === undefined &&
        (options.partXml === undefined || Object.keys(options.partXml).length === 0) &&
        (options.partBinary === undefined || Object.keys(options.partBinary).length === 0);
    if (isUnchanged)
        return originalBytes;
    const zip = await jszip_1.default.loadAsync(originalBytes);
    (0, parse_1.assertZipWithinLimits)(zip);
    // Relationship allocation for newly created hyperlinks and images.
    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    // fall back to an empty part so newly allocated rIds are never dangling
    let relsXml = relsFile
        ? await relsFile.async('string')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const newRels = [];
    let nextRelNum = maxRelId(relsXml) + 1;
    const allocateHyperlinkRel = (href) => {
        const existing = newRels.find((r) => r.external && r.target === href);
        if (existing)
            return existing.rId;
        const rId = `rId${nextRelNum++}`;
        newRels.push({ rId, type: HYPERLINK_REL_TYPE, target: href, external: true });
        return rId;
    };
    const genCtx = {
        headingStyleIds: parsed.headingStyleIds,
        listParagraphStyleId: parsed.listParagraphStyleId,
        allocateHyperlinkRel,
    };
    const newMedia = [];
    const usedExtensions = new Set();
    let imageSeq = nextImageSeq(zip);
    /** Land image bytes as a media part + relationship; returns the new rId. */
    const embedImageMedia = (image) => {
        const ext = IMAGE_EXT[image.mime];
        const mediaPath = `word/media/aidocs${imageSeq++}.${ext}`;
        const rId = `rId${nextRelNum++}`;
        newRels.push({
            rId,
            type: IMAGE_REL_TYPE,
            target: mediaPath.replace(/^word\//, ''),
            external: false,
        });
        newMedia.push({ path: mediaPath, base64: image.base64 });
        usedExtensions.add(ext);
        return rId;
    };
    const embedImage = (image) => {
        const rId = embedImageMedia(image);
        const cx = Math.max(1, Math.round(image.widthPx * EMU_PER_PX));
        const cy = Math.max(1, Math.round(image.heightPx * EMU_PER_PX));
        // Word lays the drawing out against the unrotated wp:extent plus
        // wp:effectExtent: a rotated non-square picture needs the bounding-box
        // overflow recorded there (same math as patchImageParagraphXml)
        const rot = image.rotDeg ? ((Math.round(image.rotDeg) % 360) + 360) % 360 : 0;
        const rad = (rot * Math.PI) / 180;
        const bw = Math.abs(cx * Math.cos(rad)) + Math.abs(cy * Math.sin(rad));
        const bh = Math.abs(cx * Math.sin(rad)) + Math.abs(cy * Math.cos(rad));
        const eeX = Math.max(0, Math.round((bw - cx) / 2));
        const eeY = Math.max(0, Math.round((bh - cy) / 2));
        const docPrId = 9000 + imageSeq;
        const pPr = image.align && image.align !== 'left' ? `<w:pPr><w:jc w:val="${image.align}"/></w:pPr>` : '';
        const xml = `<w:p>${pPr}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
            `<wp:extent cx="${cx}" cy="${cy}"/>` +
            `<wp:effectExtent l="${eeX}" t="${eeY}" r="${eeX}" b="${eeY}"/>` +
            `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
            `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
            `<pic:spPr><a:xfrm${rot ? ` rot="${rot * 60000}"` : ''}${image.flipH ? ' flipH="1"' : ''}${image.flipV ? ' flipV="1"' : ''}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
        return image.wrap ? (0, generate_1.applyImageWrap)(xml, image.wrap) : xml;
    };
    // ---- new embedded charts: chart part + workbook + relationship + drawing paragraph ----
    const newChartParts = [];
    const newChartWorkbooks = [];
    let chartDocPrId = 8000;
    const embedChart = async (chart, extentPx) => {
        let n = 1;
        while (zip.file(`word/charts/chart${n}.xml`) ||
            newChartParts.some((p) => p.path === `word/charts/chart${n}.xml`)) {
            n++;
        }
        const path = `word/charts/chart${n}.xml`;
        const rId = `rId${nextRelNum++}`;
        newRels.push({ rId, type: CHART_REL_TYPE, target: `charts/chart${n}.xml`, external: false });
        // Build embedded workbook and create chart rels part
        const wbBase64 = await (0, chart_1.buildChartWorkbookXlsxBase64)(chart.categories, chart.series);
        const xlsxPath = `word/charts/embeddings/workbook${n}.xlsx`;
        const wbRId = 'rId1';
        const chartRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            `<Relationship Id="${wbRId}" Type="${chart_1.CHART_WORKBOOK_REL_TYPE}" Target="embeddings/workbook${n}.xlsx"/>` +
            '</Relationships>';
        newChartParts.push({ path, xml: (0, chart_1.buildChartPartXml)(chart, wbRId) });
        newChartWorkbooks.push({
            xlsxPath,
            relsPath: `word/charts/_rels/chart${n}.xml.rels`,
            relsXml: chartRelsXml,
            base64: wbBase64,
        });
        const docPrId = chartDocPrId++;
        const cx = extentPx ? Math.max(1, Math.round(extentPx.w * 9525)) : 5486400;
        const cy = extentPx ? Math.max(1, Math.round(extentPx.h * 9525)) : 3200400;
        return ('<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
            `<wp:extent cx="${cx}" cy="${cy}"/>` +
            `<wp:docPr id="${docPrId}" name="Chart ${docPrId}"/>` +
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
            `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/>` +
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>');
    };
    // ---- ink annotations: floating anchored pictures, re-emitted wholesale ----
    const inksByBlock = new Map();
    for (const ink of options.inks ?? []) {
        const list = inksByBlock.get(ink.blockIndex);
        if (list)
            list.push(ink);
        else
            inksByBlock.set(ink.blockIndex, [ink]);
    }
    // Ink media get their own name prefix: every ink save strips + re-emits the
    // whole layer, so old word/media/aidocsink*.png parts (and their rels) are
    // dropped from the output instead of accumulating as orphans.
    let inkSeq = 1;
    /** allocate media + relationship for one ink PNG, return its anchored run */
    const inkRunXml = (ink) => {
        const mediaPath = `word/media/${ink_1.INK_MEDIA_PREFIX}${inkSeq++}.png`;
        const rId = `rId${nextRelNum++}`;
        newRels.push({
            rId,
            type: IMAGE_REL_TYPE,
            target: mediaPath.replace(/^word\//, ''),
            external: false,
        });
        newMedia.push({ path: mediaPath, base64: ink.base64 });
        usedExtensions.add('png');
        return (0, ink_1.anchoredInkRunXml)(ink, rId, 9000 + inkSeq);
    };
    // ---- header / footer: overwrite the existing default part or create one ----
    const sectBlock = parsed.blocks.find((b) => b.hidden && b.originalXml?.includes('<w:sectPr'));
    const trailingSectPr = sectBlock?.originalXml ?? '';
    const relTargets = new Map();
    if (relsXml) {
        for (const tag of relsXml.match(/<Relationship [^>]*\/>/g) ?? []) {
            const id = /Id="([^"]+)"/.exec(tag)?.[1];
            const target = /Target="([^"]+)"/.exec(tag)?.[1];
            if (id && target)
                relTargets.set(id, target);
        }
    }
    const hfParts = [];
    const hfRefTags = [];
    const hfOverrides = [];
    const planHeaderFooter = async (kind, hf, watermark = null, hfType = 'default', watermarkOnly = false) => {
        if (hf === undefined)
            return;
        const refs = trailingSectPr.match(new RegExp(`<w:${kind}Reference[^>]*/>`, 'g')) ?? [];
        const existing = refs.find((r) => r.includes(`w:type="${hfType}"`)) ??
            (hfType === 'default' ? refs.find((r) => !/w:type="/.test(r)) : undefined);
        const rId = existing ? /r:id="([^"]+)"/.exec(existing)?.[1] : undefined;
        const target = rId ? relTargets.get(rId) : undefined;
        if (target) {
            const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
            const file = zip.file(path);
            const originalXml = file ? await file.async('string') : null;
            // A watermark-only change patches the original part in place (tables/logos/fields
            // all preserved); header text edits use paragraph replace-merge (non-paragraph
            // children preserved).
            let partXml = null;
            if (watermarkOnly && kind === 'header' && originalXml) {
                partXml = patchWatermarkInPart(originalXml, watermark);
            }
            if (partXml === null)
                partXml = headerFooterPartXml(kind, hf, watermark, originalXml);
            hfParts.push({ path, xml: partXml });
        }
        else {
            const partXml = headerFooterPartXml(kind, hf, watermark);
            let n = 1;
            while (zip.file(`word/${kind}${n}.xml`) ||
                hfParts.some((p) => p.path === `word/${kind}${n}.xml`))
                n++;
            const filename = `${kind}${n}.xml`;
            const newRId = `rId${nextRelNum++}`;
            newRels.push({ rId: newRId, type: HF_REL_TYPE[kind], target: filename, external: false });
            hfParts.push({ path: `word/${filename}`, xml: partXml });
            hfRefTags.push(`<w:${kind}Reference w:type="${hfType}" r:id="${newRId}"/>`);
            hfOverrides.push(`<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
        }
    };
    // A watermark change forces a header-part rewrite even when the header text
    // itself is untouched; conversely a header rewrite must carry the existing
    // watermark through (the part is regenerated wholesale).
    const effectiveHeader = options.header ??
        (options.watermark !== undefined ? { text: parsed.headerText ?? '' } : undefined);
    const effectiveWatermark = options.watermark !== undefined ? options.watermark : (parsed.watermarkText ?? null);
    await planHeaderFooter('header', effectiveHeader, effectiveWatermark, 'default', options.header === undefined);
    await planHeaderFooter('footer', options.footer);
    await planHeaderFooter('header', options.headerFirst, null, 'first');
    await planHeaderFooter('footer', options.footerFirst, null, 'first');
    await planHeaderFooter('header', options.headerEven, null, 'even');
    await planHeaderFooter('footer', options.footerEven, null, 'even');
    // ---- Per-section header/footer (non-last sections): with a reference, rewrite the
    // part; without one, create a part + inject the reference ----
    const sectionRefTags = new Map();
    for (const edit of options.sectionHf ?? []) {
        const block = parsed.blocks.find((b) => b.docxIndex === edit.lastBlockIndex);
        const sectPr = block?.originalXml?.match(/<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? '';
        const refs = sectPr.match(new RegExp(`<w:${edit.kind}Reference[^>]*/>`, 'g')) ?? [];
        const existing = refs.find((r) => r.includes('w:type="default"')) ?? refs.find((r) => !/w:type="/.test(r));
        const rId = existing ? /r:id="([^"]+)"/.exec(existing)?.[1] : undefined;
        const target = rId ? relTargets.get(rId) : undefined;
        if (target) {
            const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
            const file = zip.file(path);
            const originalXml = file ? await file.async('string') : null;
            hfParts.push({ path, xml: headerFooterPartXml(edit.kind, edit.hf, null, originalXml) });
        }
        else {
            const partXml = headerFooterPartXml(edit.kind, edit.hf, null);
            let n = 1;
            while (zip.file(`word/${edit.kind}${n}.xml`) ||
                hfParts.some((p) => p.path === `word/${edit.kind}${n}.xml`))
                n++;
            const filename = `${edit.kind}${n}.xml`;
            const newRId = `rId${nextRelNum++}`;
            newRels.push({ rId: newRId, type: HF_REL_TYPE[edit.kind], target: filename, external: false });
            hfParts.push({ path: `word/${filename}`, xml: partXml });
            hfOverrides.push(`<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${edit.kind}+xml"/>`);
            const tags = sectionRefTags.get(edit.lastBlockIndex) ?? [];
            tags.push(`<w:${edit.kind}Reference w:type="default" r:id="${newRId}"/>`);
            sectionRefTags.set(edit.lastBlockIndex, tags);
        }
    }
    // ---- numbering: append numbering definitions (create the part from the blank
    // template when missing) ----
    const numberingPath = 'word/numbering.xml';
    let numberingXmlOut = null;
    let numberingIsNew = false;
    if ((options.numbering?.newDefs?.length ?? 0) > 0 ||
        (options.numbering?.restartNums?.length ?? 0) > 0) {
        const file = zip.file(numberingPath);
        let xml = file ? await file.async('string') : null;
        if (xml === null) {
            xml = blank_1.BLANK_NUMBERING_XML;
            numberingIsNew = true;
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: NUMBERING_REL_TYPE,
                target: 'numbering.xml',
                external: false,
            });
        }
        // New abstractNum ids are assigned by the engine (the App only ever sees abstracts
        // referenced by a w:num)
        let maxAbs = -1;
        for (const m of xml.matchAll(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"/g)) {
            maxAbs = Math.max(maxAbs, parseInt(m[1], 10));
        }
        const absXmls = [];
        const numXmls = [];
        for (const def of options.numbering?.newDefs ?? []) {
            const absId = String(++maxAbs);
            absXmls.push((0, blank_1.abstractNumXml)(absId, def.kind, def.levels));
            numXmls.push(`<w:num w:numId="${def.numId}"><w:abstractNumId w:val="${absId}"/></w:num>`);
        }
        for (const r of options.numbering?.restartNums ?? []) {
            const overrides = Object.entries(r.startOverrides)
                .map(([ilvl, v]) => `<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="${v}"/></w:lvlOverride>`)
                .join('');
            numXmls.push(`<w:num w:numId="${r.numId}"><w:abstractNumId w:val="${r.abstractNumId}"/>${overrides}</w:num>`);
        }
        // Schema order: abstractNum* comes before num* — insert new abstracts before the first w:num
        if (absXmls.length > 0) {
            xml = /<w:num[\s>]/.test(xml)
                ? xml.replace(/<w:num[\s>]/, (m) => absXmls.join('') + m)
                : xml.replace('</w:numbering>', `${absXmls.join('')}</w:numbering>`);
        }
        xml = xml.replace('</w:numbering>', `${numXmls.join('')}</w:numbering>`);
        numberingXmlOut = xml;
    }
    // ---- styles: surgical upsert of word/styles.xml (create/modify styles) ----
    const stylesPath = 'word/styles.xml';
    let stylesXmlOut = null;
    if ((options.styleUpserts?.length ?? 0) > 0) {
        const file = zip.file(stylesPath);
        let xml = file
            ? await file.async('string')
            : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
                '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>';
        for (const up of options.styleUpserts ?? []) {
            const styleXml = buildStyleXml(up);
            const existing = new RegExp(`<w:style [^>]*w:styleId="${up.styleId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}"[\\s\\S]*?</w:style>`);
            xml = existing.test(xml)
                ? xml.replace(existing, styleXml)
                : xml.replace('</w:styles>', `${styleXml}</w:styles>`);
        }
        stylesXmlOut = xml;
    }
    // ---- comments: regenerate word/comments.xml from the full desired list ----
    const commentsPath = 'word/comments.xml';
    const commentsExtPath = 'word/commentsExtended.xml';
    let commentsXml = null;
    let commentsIsNew = false;
    let commentsExtXml = null;
    let commentsExtIsNew = false;
    if (options.comments) {
        // Ensure every comment has a paraId (the commentsExtended link key; old comments
        // carry theirs in the original bytes)
        let paraSeq = 1;
        const withParaIds = options.comments.map((c) => c.paraId
            ? c
            : {
                ...c,
                paraId: (0x10000000 + paraSeq++ * 0x1111 + parseInt(c.id, 10))
                    .toString(16)
                    .toUpperCase()
                    .padStart(8, '0'),
            });
        const commentsFile = zip.file(commentsPath);
        commentsXml = buildCommentsXml(withParaIds, commentsFile ? await commentsFile.async('string') : null);
        if (!zip.file(commentsPath)) {
            commentsIsNew = true;
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: COMMENTS_REL_TYPE,
                target: 'comments.xml',
                external: false,
            });
        }
        // Regenerate commentsExtended.xml in step when replies/resolved flags exist, or the
        // part already exists
        const needExt = zip.file(commentsExtPath) !== null ||
            withParaIds.some((c) => c.parentId !== undefined || c.done !== undefined);
        if (needExt) {
            commentsExtXml = buildCommentsExtendedXml(withParaIds);
            if (!zip.file(commentsExtPath)) {
                commentsExtIsNew = true;
                newRels.push({
                    rId: `rId${nextRelNum++}`,
                    type: COMMENTS_EXT_REL_TYPE,
                    target: 'commentsExtended.xml',
                    external: false,
                });
            }
        }
    }
    // ---- footnotes / endnotes: regenerate the part from the full desired list ----
    const notesParts = [];
    const planNotes = async (kind, notes) => {
        if (!notes)
            return;
        const path = notes_1.NOTE_PART_PATH[kind];
        const file = zip.file(path);
        const originalXml = file ? await file.async('string') : null;
        notesParts.push({ path, xml: (0, notes_1.buildNotesXml)(kind, notes, originalXml), isNew: !file, kind });
        if (!file) {
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: notes_1.NOTE_REL_TYPE[kind],
                target: path.replace(/^word\//, ''),
                external: false,
            });
        }
    };
    await planNotes('footnote', options.footnotes);
    await planNotes('endnote', options.endnotes);
    // ---- bibliography sources: the b:Sources customXml part ----
    let sourcesPart = null;
    if (options.sources) {
        const existing = await (0, sources_1.findSourcesPart)(zip);
        const xml = (0, sources_1.buildSourcesXml)(options.sources, existing ? await zip.file(existing).async('string') : null);
        if (existing) {
            const n = /item(\d+)\.xml$/.exec(existing)?.[1] ?? '1';
            sourcesPart = { path: existing, propsPath: `customXml/itemProps${n}.xml`, xml, isNew: false };
        }
        else {
            let n = 1;
            while (zip.file(`customXml/item${n}.xml`))
                n++;
            sourcesPart = {
                path: `customXml/item${n}.xml`,
                propsPath: `customXml/itemProps${n}.xml`,
                xml,
                isNew: true,
            };
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: sources_1.CUSTOM_XML_REL_TYPE,
                target: `../customXml/item${n}.xml`,
                external: false,
            });
        }
    }
    // ---- theme fonts / colors: patch or create word/theme/theme1.xml ----
    let themePart = null;
    if (options.themeFonts || options.themeColors) {
        const themeFile = zip.file(theme_1.THEME_PART_PATH);
        if (themeFile) {
            let xml = await themeFile.async('string');
            if (options.themeFonts)
                xml = (0, theme_1.applyThemeFonts)(xml, options.themeFonts);
            if (options.themeColors)
                xml = (0, theme_1.applyThemeColors)(xml, options.themeColors);
            themePart = { xml, isNew: false };
        }
        else {
            themePart = {
                xml: (0, theme_1.buildThemeXml)(options.themeFonts ?? { major: 'Calibri Light', minor: 'Calibri', eastAsia: '' }, options.themeColors ?? {}),
                isNew: true,
            };
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: theme_1.THEME_REL_TYPE,
                target: 'theme/theme1.xml',
                external: false,
            });
        }
    }
    const parts = [];
    for (let i = 0; i < finalBlocks.length; i++) {
        const fb = finalBlocks[i];
        let xml;
        let fbDocxIndex;
        if (fb.kind === 'original') {
            const el = elements[fb.docxIndex];
            if (!el)
                throw new Error(`invalid docxIndex ${fb.docxIndex}`);
            xml = documentXml.slice(el.start, el.end);
            fbDocxIndex = fb.docxIndex;
        }
        else if (fb.kind === 'generated') {
            xml = (0, generate_1.generateParagraphXml)(fb.block, genCtx);
            // If the original paragraph was inside a w:sdt shell, re-wrap it
            if (fb.block.sdtShell) {
                xml = fb.block.sdtShell.openXml + xml + fb.block.sdtShell.closeXml;
            }
        }
        else if (fb.kind === 'xml') {
            xml = fb.xml;
            fbDocxIndex = fb.docxIndex;
            if (fb.replaceImage)
                xml = retargetImageBlip(xml, embedImageMedia(fb.replaceImage));
        }
        else if (fb.kind === 'chart') {
            xml = await embedChart(fb.chart, fb.extentPx);
        }
        else {
            xml = embedImage(fb.image);
        }
        // Inject newly created per-section header/footer references into the section's sectPr
        // (the reference must be the first sectPr child)
        const refTags = fbDocxIndex !== undefined ? sectionRefTags.get(fbDocxIndex) : undefined;
        if (refTags && refTags.length > 0) {
            xml = xml.replace(/(<w:sectPr[^>]*>)/, `$1${refTags.join('')}`);
        }
        // The ink list is authoritative: old aidocs-ink runs go away, the desired
        // set is re-injected at its (possibly new) anchor paragraphs.
        if (options.inks !== undefined)
            xml = (0, ink_1.stripInkRuns)(xml);
        // check anchor viability BEFORE allocating media, so a non-paragraph
        // anchor doesn't leave orphan relationship/media entries behind
        const blockInks = inksByBlock.get(i);
        if (blockInks && /^<w:p[\s/>]/.test(xml)) {
            const injected = (0, ink_1.injectInkRunsIntoParagraph)(xml, blockInks.map(inkRunXml).join(''));
            if (injected !== null)
                xml = injected;
        }
        if (fb.revision && !new RegExp(`^<w:${fb.revision.kind}[\\s>]`).test(xml)) {
            const revision = fb.revision;
            const attrs = ` w:id="${(0, xml_utils_1.escapeXmlAttr)(revision.id ?? '0')}"` +
                ` w:author="${(0, xml_utils_1.escapeXmlAttr)(revision.author)}"` +
                (revision.date ? ` w:date="${(0, xml_utils_1.escapeXmlAttr)(revision.date)}"` : '');
            xml = `<w:${revision.kind}${attrs}>${xml}</w:${revision.kind}>`;
        }
        parts.push(xml);
    }
    // Trailing hidden elements (w:sectPr) always keep their original bytes and position,
    // unless the editor changed the page setup.
    for (const block of parsed.blocks) {
        if (block.hidden && block.docxIndex !== null) {
            const el = elements[block.docxIndex];
            let xml = documentXml.slice(el.start, el.end);
            if (xml.includes('<w:sectPr')) {
                if (options.section)
                    xml = (0, section_1.applySectionSettings)(xml, options.section);
                if (options.sectionStartType)
                    xml = (0, section_1.applySectionStartType)(xml, options.sectionStartType);
                if (options.pgNumType)
                    xml = (0, section_1.applyPageNumType)(xml, options.pgNumType.fmt, options.pgNumType.start);
                if (options.titlePg !== undefined)
                    xml = applyTitlePg(xml, options.titlePg);
                // headerReference/footerReference must be the first sectPr children
                if (hfRefTags.length > 0) {
                    xml = xml.replace(/(<w:sectPr[^>]*>)/, `$1${hfRefTags.join('')}`);
                }
            }
            parts.push(xml);
        }
    }
    let newDocumentXml = documentXml.slice(0, bodyInnerStart) + parts.join('') + documentXml.slice(bodyInnerEnd);
    // editor-generated formulas need the math namespace on the document root;
    // docx produced by non-Word generators may not declare it
    if (newDocumentXml.includes('<m:') && !/<w:document[^>]*xmlns:m=/.test(newDocumentXml)) {
        newDocumentXml = newDocumentXml.replace(/<w:document /, '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ');
    }
    if (options.pageColor !== undefined) {
        newDocumentXml = applyPageColor(newDocumentXml, options.pageColor);
    }
    const settingsPath = 'word/settings.xml';
    let settingsXml = null;
    let settingsIsNew = false;
    if (options.pageColor ||
        options.protection !== undefined ||
        options.evenAndOddHeaders !== undefined) {
        const file = zip.file(settingsPath);
        let xml;
        let touched = false;
        if (file) {
            xml = await file.async('string');
        }
        else {
            xml =
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>';
            settingsIsNew = true;
            touched = true;
            newRels.push({
                rId: `rId${nextRelNum++}`,
                type: SETTINGS_REL_TYPE,
                target: 'settings.xml',
                external: false,
            });
        }
        // Word only renders w:background when settings.xml opts in.
        if (options.pageColor && !xml.includes('<w:displayBackgroundShape')) {
            xml = xml.replace(/(<w:settings[^>]*>)/, '$1<w:displayBackgroundShape/>');
            touched = true;
        }
        if (options.protection !== undefined) {
            xml = applyProtection(xml, options.protection);
            touched = true;
        }
        if (options.evenAndOddHeaders !== undefined) {
            xml = applyEvenAndOddHeaders(xml, options.evenAndOddHeaders);
            touched = true;
        }
        if (touched)
            settingsXml = xml;
    }
    let relsChanged = false;
    // drop relationships of stripped ink runs (their media parts are dropped too)
    if (options.inks !== undefined && relsXml) {
        const cleaned = relsXml.replace(ink_1.INK_REL_RE, '');
        if (cleaned !== relsXml) {
            relsXml = cleaned;
            relsChanged = true;
        }
    }
    if (newRels.length > 0 && relsXml) {
        const inserts = newRels
            .map((r) => `<Relationship Id="${(0, xml_utils_1.escapeXmlAttr)(r.rId)}" Type="${r.type}" Target="${(0, xml_utils_1.escapeXmlAttr)(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
            .join('');
        relsXml = relsXml.replace('</Relationships>', `${inserts}</Relationships>`);
        relsChanged = true;
    }
    const contentTypesPath = '[Content_Types].xml';
    let contentTypesXml = null;
    const hasNewParts = usedExtensions.size > 0 ||
        hfOverrides.length > 0 ||
        newChartParts.length > 0 ||
        newChartWorkbooks.length > 0 ||
        settingsIsNew ||
        commentsIsNew ||
        commentsExtIsNew ||
        numberingIsNew ||
        notesParts.some((p) => p.isNew) ||
        sourcesPart?.isNew ||
        themePart?.isNew;
    if (hasNewParts) {
        const file = zip.file(contentTypesPath);
        if (file) {
            contentTypesXml = await file.async('string');
            const addOverride = (partName, contentType) => {
                if (!contentTypesXml.includes(`PartName="${partName}"`)) {
                    contentTypesXml = contentTypesXml.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
                }
            };
            for (const ext of usedExtensions) {
                if (!new RegExp(`Extension="${ext}"`).test(contentTypesXml)) {
                    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                    contentTypesXml = contentTypesXml.replace('</Types>', `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
                }
            }
            for (const override of hfOverrides) {
                const partName = /PartName="([^"]+)"/.exec(override)?.[1] ?? '';
                if (!contentTypesXml.includes(`PartName="${partName}"`)) {
                    contentTypesXml = contentTypesXml.replace('</Types>', `${override}</Types>`);
                }
            }
            if (commentsIsNew) {
                addOverride('/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');
            }
            if (commentsExtIsNew) {
                addOverride('/word/commentsExtended.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml');
            }
            if (settingsIsNew) {
                addOverride('/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml');
            }
            if (numberingIsNew) {
                addOverride('/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml');
            }
            for (const part of newChartParts)
                addOverride(`/${part.path}`, CHART_CONTENT_TYPE);
            for (const wb of newChartWorkbooks)
                addOverride(`/${wb.xlsxPath}`, XLSX_CONTENT_TYPE);
            for (const part of notesParts) {
                if (part.isNew)
                    addOverride(`/${part.path}`, notes_1.NOTE_CONTENT_TYPE[part.kind]);
            }
            if (sourcesPart?.isNew) {
                addOverride(`/${sourcesPart.propsPath}`, 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml');
            }
            if (themePart?.isNew)
                addOverride(`/${theme_1.THEME_PART_PATH}`, theme_1.THEME_CONTENT_TYPE);
        }
    }
    const coreEntry = zip.file(CORE_PROPS_PATH);
    const coreXmlOut = coreEntry
        ? patchCoreProps(await coreEntry.async('string'), options.savedAt)
        : null;
    const out = new jszip_1.default();
    for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) {
            out.folder(name);
            continue;
        }
        // old ink PNGs are re-emitted from options.inks; don't carry orphans over
        if (options.inks !== undefined && ink_1.INK_MEDIA_PATH_RE.test(name))
            continue;
        const hfPart = hfParts.find((p) => p.path === name);
        if (name === 'word/document.xml') {
            out.file(name, newDocumentXml, { date: entry.date });
        }
        else if (hfPart) {
            out.file(name, hfPart.xml, { date: entry.date });
        }
        else if (name === relsPath && relsChanged && relsXml) {
            out.file(name, relsXml, { date: entry.date });
        }
        else if (name === contentTypesPath && contentTypesXml !== null) {
            out.file(name, contentTypesXml, { date: entry.date });
        }
        else if (name === settingsPath && settingsXml !== null) {
            out.file(name, settingsXml, { date: entry.date });
        }
        else if (name === commentsPath && commentsXml !== null) {
            out.file(name, commentsXml, { date: entry.date });
        }
        else if (name === commentsExtPath && commentsExtXml !== null) {
            out.file(name, commentsExtXml, { date: entry.date });
        }
        else if (name === numberingPath && numberingXmlOut !== null) {
            out.file(name, numberingXmlOut, { date: entry.date });
        }
        else if (name === stylesPath && stylesXmlOut !== null) {
            out.file(name, stylesXmlOut, { date: entry.date });
        }
        else if (notesParts.some((p) => p.path === name)) {
            out.file(name, notesParts.find((p) => p.path === name).xml, { date: entry.date });
        }
        else if (sourcesPart && name === sourcesPart.path) {
            out.file(name, sourcesPart.xml, { date: entry.date });
        }
        else if (themePart && name === theme_1.THEME_PART_PATH) {
            out.file(name, themePart.xml, { date: entry.date });
        }
        else if (name === CORE_PROPS_PATH && coreXmlOut !== null) {
            out.file(name, coreXmlOut, { date: entry.date });
        }
        else if (options.partXml && options.partXml[name] !== undefined) {
            out.file(name, options.partXml[name], { date: entry.date });
        }
        else if (options.partBinary && options.partBinary[name] !== undefined) {
            out.file(name, options.partBinary[name], { base64: true, date: entry.date });
        }
        else {
            out.file(name, await entry.async('uint8array'), { date: entry.date });
        }
    }
    for (const media of newMedia) {
        out.file(media.path, media.base64, { base64: true });
    }
    for (const part of hfParts) {
        if (!zip.file(part.path))
            out.file(part.path, part.xml);
    }
    if (relsChanged && relsXml && !zip.file(relsPath)) {
        out.file(relsPath, relsXml);
    }
    if (commentsIsNew && commentsXml !== null) {
        out.file(commentsPath, commentsXml);
    }
    if (commentsExtIsNew && commentsExtXml !== null) {
        out.file(commentsExtPath, commentsExtXml);
    }
    if (numberingIsNew && numberingXmlOut !== null) {
        out.file(numberingPath, numberingXmlOut);
    }
    if (stylesXmlOut !== null && !zip.file(stylesPath)) {
        out.file(stylesPath, stylesXmlOut);
    }
    if (settingsIsNew && settingsXml !== null) {
        out.file(settingsPath, settingsXml);
    }
    for (const part of newChartParts) {
        out.file(part.path, part.xml);
    }
    for (const wb of newChartWorkbooks) {
        if (!zip.file(wb.relsPath)) {
            out.file(wb.relsPath, wb.relsXml);
        }
        out.file(wb.xlsxPath, wb.base64, { base64: true });
    }
    for (const part of notesParts) {
        if (part.isNew)
            out.file(part.path, part.xml);
    }
    if (sourcesPart?.isNew) {
        out.file(sourcesPart.path, sourcesPart.xml);
        out.file(sourcesPart.propsPath, (0, sources_1.buildSourcesItemPropsXml)());
        const relsName = sourcesPart.path.replace(/^customXml\//, '').replace(/\.xml$/, '');
        out.file(`customXml/_rels/${relsName}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="${sourcesPart.propsPath.replace(/^customXml\//, '')}"/>` +
            '</Relationships>');
    }
    if (themePart?.isNew) {
        out.file(theme_1.THEME_PART_PATH, themePart.xml);
    }
    return out.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
}
/**
 * Standalone header/footer part: one centered paragraph, optional PAGE field.
 * PAGE_MARK in the text marks where the page number goes; a user-typed '#'
 * still counts when no PAGE_MARK exists (e.g. "- # -"). Headers additionally
 * carry the page watermark shape when one is set.
 */
/** Add the namespaces a VML watermark needs to the original part's root tag (existing ones untouched) */
function withWatermarkNs(openTag) {
    let out = openTag;
    for (const ns of [
        'xmlns:v="urn:schemas-microsoft-com:vml"',
        'xmlns:o="urn:schemas-microsoft-com:office:office"',
        'xmlns:w10="urn:schemas-microsoft-com:office:word"',
    ]) {
        if (!out.includes(ns.split('=')[0] + '='))
            out = out.replace(/>$/, ` ${ns}>`);
    }
    return out;
}
/**
 * In-place patch for a watermark-only change: drop the old watermark paragraph (<w:p>
 * containing v:textpath), insert the new watermark at the start of the part, and keep
 * everything else (paragraph formatting/tables/logos/fields) byte-identical. Returns
 * null when the root tag cannot be recognized so the caller falls back to a full rebuild.
 */
function patchWatermarkInPart(originalXml, watermark) {
    const open = /<w:hdr[^>]*>/.exec(originalXml)?.[0];
    if (!open)
        return null;
    const openIdx = originalXml.indexOf(open);
    const closeIdx = originalXml.lastIndexOf('</w:hdr>');
    if (closeIdx < 0)
        return null;
    const prefix = originalXml.slice(0, openIdx);
    const inner = originalXml.slice(openIdx + open.length, closeIdx);
    const kept = (0, generate_1.splitXmlChildren)(inner).filter((c) => !(c.name === 'w:p' && c.xml.includes('<v:textpath')));
    const wm = watermark ? (0, watermark_1.watermarkParagraphXml)(watermark) : '';
    const rootOpen = watermark ? withWatermarkNs(open) : open;
    return `${prefix}${rootOpen}${wm}${kept.map((c) => c.xml).join('')}</w:hdr>`;
}
function headerFooterPartXml(kind, hf, watermark = null, originalXml = null) {
    const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
    const textRun = (t) => t ? `<w:r><w:t xml:space="preserve">${(0, xml_utils_1.escapeXmlText)(t)}</w:t></w:r>` : '';
    const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const numPagesField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    let content;
    if (hf.paras) {
        // rich paragraphs; every PAGE_MARK becomes a PAGE field and every
        // TOTAL_PAGES_MARK a NUMPAGES field. Only when no PAGE_MARK exists does a
        // user-typed '#' stand in (first occurrence only — literal '#' text in a
        // part that has real marks must stay literal).
        const hasPageMark = hf.paras.some((p) => [p.runs, ...(p.cells?.map((c) => c.runs) ?? [])].some((rs) => rs.some((r) => r.text.includes(types_1.PAGE_MARK))));
        let pageEmitted = !hf.pageNumber || hasPageMark;
        content = hf.paras
            // table-row paragraphs are display-only: the part's original w:tbl bytes are kept below
            .filter((para) => !para.cells)
            .map((para) => {
            // the parsed format, not just w:jc: hand-building it here dropped w:bidi and wrote
            // the visual align back as the logical one, flipping RTL headers to LTR
            const pPr = (0, generate_1.mergePPrFormat)('<w:pPr/>', para);
            let runs = '';
            for (const run of para.runs) {
                if (run.text.includes(types_1.TOTAL_PAGES_MARK) ||
                    run.text.includes(types_1.PAGE_MARK) ||
                    (!pageEmitted && run.text.includes('#'))) {
                    run.text.split(types_1.TOTAL_PAGES_MARK).forEach((seg, k) => {
                        if (k > 0)
                            runs += numPagesField;
                        if (seg.includes(types_1.PAGE_MARK)) {
                            seg.split(types_1.PAGE_MARK).forEach((piece, j) => {
                                if (j > 0)
                                    runs += pageField;
                                if (piece)
                                    runs += (0, generate_1.inlineRunsXml)([{ ...run, text: piece }]);
                            });
                        }
                        else if (!pageEmitted && seg.includes('#')) {
                            const [before, ...rest] = seg.split('#');
                            runs +=
                                (0, generate_1.inlineRunsXml)(before ? [{ ...run, text: before }] : []) +
                                    pageField +
                                    (0, generate_1.inlineRunsXml)(rest.join('#') ? [{ ...run, text: rest.join('#') }] : []);
                            pageEmitted = true;
                        }
                        else if (seg) {
                            runs += (0, generate_1.inlineRunsXml)([{ ...run, text: seg }]);
                        }
                    });
                }
                else {
                    runs += (0, generate_1.inlineRunsXml)([run]);
                }
            }
            return `<w:p>${pPr}${runs}</w:p>`;
        })
            .join('');
        if (!pageEmitted)
            content += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${pageField}</w:p>`;
    }
    else {
        const textWithTotal = (t) => t.split(types_1.TOTAL_PAGES_MARK).map(textRun).join(numPagesField);
        const runs = [];
        if (hf.text.includes(types_1.PAGE_MARK)) {
            runs.push(hf.text.split(types_1.PAGE_MARK).map(textWithTotal).join(pageField));
        }
        else if (hf.pageNumber && hf.text.includes('#')) {
            const [before, ...rest] = hf.text.split('#');
            runs.push(textWithTotal(before), pageField, textWithTotal(rest.join('#')));
        }
        else {
            if (hf.text)
                runs.push(textWithTotal(hf.text + (hf.pageNumber ? ' ' : '')));
            if (hf.pageNumber)
                runs.push(pageField);
        }
        content = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs.join('')}</w:p>`;
    }
    const watermarkXml = kind === 'header' && watermark ? (0, watermark_1.watermarkParagraphXml)(watermark) : '';
    const body = `${watermarkXml}${content}`;
    // Surgical merge: non-paragraph children of the original part (tables/sdt) and
    // paragraphs containing images/objects (logos etc., which are not in the text-paragraph
    // model) keep their original bytes; only the set of text paragraphs is replaced as a
    // whole at the position of the first text paragraph. The watermark paragraph
    // (v:textpath) is the exception — it is regenerated from watermarkXml.
    if (originalXml) {
        const open = new RegExp(`<${root}[^>]*>`).exec(originalXml)?.[0];
        const closeIdx = originalXml.lastIndexOf(`</${root}>`);
        if (open && closeIdx >= 0) {
            const openIdx = originalXml.indexOf(open);
            const children = (0, generate_1.splitXmlChildren)(originalXml.slice(openIdx + open.length, closeIdx));
            const isProtectedPara = (xml) => /<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/.test(xml) && !xml.includes('<v:textpath');
            const isTextPara = (c) => c.name === 'w:p' && !isProtectedPara(c.xml);
            if (children.some((c) => !isTextPara(c))) {
                const parts = [];
                let injected = false;
                for (const c of children) {
                    if (isTextPara(c)) {
                        if (!injected) {
                            parts.push(body);
                            injected = true;
                        }
                    }
                    else if (c.name === 'w:p' && c.xml.includes('<v:textpath')) {
                        // Drop the old watermark paragraph (body already carries the regenerated watermarkXml)
                    }
                    else {
                        parts.push(c.xml);
                    }
                }
                if (!injected)
                    parts.unshift(body);
                const rootOpen = watermarkXml ? withWatermarkNs(open) : open;
                return `${originalXml.slice(0, openIdx)}${rootOpen}${parts.join('')}</${root}>`;
            }
        }
    }
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
        `${watermark_1.WATERMARK_NS}>` +
        `${body}</${root}>`);
}
/** word/comments.xml regenerated from the comment list (plain-text bodies). */
/**
 * Surgical rebuild of comments.xml: existing comments whose text is unchanged keep
 * their original bytes (rich formatting/multiple paragraphs/inline hyperlinks are
 * preserved); only new or edited comments fall back to a plain-text rebuild.
 */
const COMMENTS_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
function buildCommentsXml(comments, originalXml) {
    const originals = new Map();
    if (originalXml) {
        for (const m of originalXml.match(/<w:comment\s[^>]*>[\s\S]*?<\/w:comment>/g) ?? []) {
            const id = /w:id="([^"]+)"/.exec(m)?.[1];
            if (id)
                originals.set(id, { text: commentPlainText(m), xml: m });
        }
    }
    const body = comments
        .map((c) => {
        const orig = originals.get(c.id);
        if (orig && orig.text === c.text)
            return orig.xml;
        if (orig) {
            // In-paragraph w:t-level patch: text edits keep the comment's rich formatting,
            // multiple paragraphs, and inline links
            const patched = (0, text_patch_1.patchParagraphTexts)(orig.xml, c.text);
            if (patched !== null)
                return patched;
        }
        const attrs = `w:id="${(0, xml_utils_1.escapeXmlAttr)(c.id)}" w:author="${(0, xml_utils_1.escapeXmlAttr)(c.author)}"` +
            (c.initials ? ` w:initials="${(0, xml_utils_1.escapeXmlAttr)(c.initials)}"` : '') +
            (c.date ? ` w:date="${(0, xml_utils_1.escapeXmlAttr)(c.date)}"` : '');
        const lines = c.text.split('\n');
        const paras = lines
            .map((line, i) => {
            // The last paragraph carries w14:paraId (the commentsExtended link key)
            const pid = i === lines.length - 1 && c.paraId ? ` w14:paraId="${(0, xml_utils_1.escapeXmlAttr)(c.paraId)}"` : '';
            return `<w:p${pid}><w:r><w:t xml:space="preserve">${(0, xml_utils_1.escapeXmlText)(line)}</w:t></w:r></w:p>`;
        })
            .join('');
        return `<w:comment ${attrs}>${paras}</w:comment>`;
    })
        .join('');
    // Rebuilt comments always emit w14:paraId (ensured above), so w14 must be bound even
    // when the original root — e.g. from a non-Word producer — never declared it.
    const ns = (0, notes_1.rootAttributes)(originalXml, 'w:comments', COMMENTS_NS, {
        w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${ns}>${body}</w:comments>`;
}
/** word/commentsExtended.xml: one commentEx per comment (reply parent-child + resolved flag) */
function buildCommentsExtendedXml(comments) {
    const paraIdOf = new Map(comments.map((c) => [c.id, c.paraId]));
    const body = comments
        .filter((c) => c.paraId)
        .map((c) => {
        const parentParaId = c.parentId ? paraIdOf.get(c.parentId) : undefined;
        return (`<w15:commentEx w15:paraId="${(0, xml_utils_1.escapeXmlAttr)(c.paraId)}"` +
            (parentParaId ? ` w15:paraIdParent="${(0, xml_utils_1.escapeXmlAttr)(parentParaId)}"` : '') +
            ` w15:done="${c.done ? '1' : '0'}"/>`);
    })
        .join('');
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"' +
        ' xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">' +
        `${body}</w15:commentsEx>`);
}
/** Aligned with parseComments' textOf: each w:p's w:t text, '\n' between paragraphs */
function commentPlainText(commentXml) {
    const paras = [];
    const pRe = /<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g;
    let p;
    while ((p = pRe.exec(commentXml)) !== null) {
        const texts = [];
        const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
        let t;
        while ((t = tRe.exec(p[0])) !== null)
            texts.push(t[1]);
        paras.push(texts
            .join('')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&'));
    }
    return paras.join('\n');
}
/** set or remove <w:documentProtection> right after the settings root opens */
function applyProtection(xml, protection) {
    let out = xml.replace(/<w:documentProtection[^>]*\/>/, '');
    if (protection) {
        const crypt = protection.hash
            ? ' w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny"' +
                ` w:cryptAlgorithmSid="${protection.algorithmSid ?? 14}"` +
                ` w:cryptSpinCount="${protection.spinCount ?? 100000}"` +
                ` w:hash="${(0, xml_utils_1.escapeXmlAttr)(protection.hash)}"` +
                (protection.salt ? ` w:salt="${(0, xml_utils_1.escapeXmlAttr)(protection.salt)}"` : '')
            : '';
        const tag = `<w:documentProtection w:edit="${(0, xml_utils_1.escapeXmlAttr)(protection.edit)}"` +
            (protection.enforced ? ' w:enforcement="1"' : '') +
            crypt +
            '/>';
        out = out.replace(/(<w:settings[^>]*>)/, `$1${tag}`);
    }
    return out;
}
/** set or remove <w:titlePg/> ("different first page"), before w:docGrid per schema order */
function applyTitlePg(sectPrXml, on) {
    let xml = sectPrXml.replace(/<w:titlePg[^>]*\/>/, '');
    if (on) {
        if (/<w:docGrid/.test(xml))
            xml = xml.replace(/<w:docGrid/, '<w:titlePg/><w:docGrid');
        else
            xml = xml.replace(/<\/w:sectPr>/, '<w:titlePg/></w:sectPr>');
    }
    return xml;
}
/** set or remove <w:evenAndOddHeaders/> right after the settings root opens */
function applyEvenAndOddHeaders(xml, on) {
    const out = xml.replace(/<w:evenAndOddHeaders[^>]*\/>/, '');
    return on ? out.replace(/(<w:settings[^>]*>)/, '$1<w:evenAndOddHeaders/>') : out;
}
/** Set, replace or remove <w:background> (must be the first child of w:document). */
function applyPageColor(documentXml, color) {
    let xml = documentXml.replace(/<w:background[^>]*\/>/, '');
    if (color) {
        xml = xml.replace(/(<w:document[^>]*>)/, `$1<w:background w:color="${(0, xml_utils_1.escapeXmlAttr)(color)}"/>`);
    }
    return xml;
}
function maxRelId(relsXml) {
    if (!relsXml)
        return 1000;
    let max = 0;
    const re = /Id="rId(\d+)"/g;
    let m;
    while ((m = re.exec(relsXml)) !== null) {
        max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
}
function nextImageSeq(zip) {
    let max = 0;
    for (const name of Object.keys(zip.files)) {
        const m = /^word\/media\/aidocs(\d+)\./.exec(name);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
}
/**
 * Re-point a drawing paragraph's first <a:blip> at a new image relationship
 * (external r:link becomes embedded) and drop a stale <a:srcRect> crop — the
 * editor shows the full image, so a Word-authored crop window applied to the
 * swapped bytes would show an arbitrary region.
 */
function retargetImageBlip(xml, rId) {
    const blip = /<a:blip\b[^>]*\/?>/.exec(xml);
    if (!blip)
        return xml;
    let tag = blip[0];
    // Word "insert and link" pictures carry both attributes: a surviving r:link
    // would let Word refresh from the old external file, discarding the swap
    if (/r:embed="/.test(tag))
        tag = tag.replace(/r:embed="[^"]*"/, `r:embed="${rId}"`).replace(/\s+r:link="[^"]*"/, '');
    else if (/r:link="/.test(tag))
        tag = tag.replace(/r:link="[^"]*"/, `r:embed="${rId}"`);
    else
        tag = tag.replace(/<a:blip\b/, `<a:blip r:embed="${rId}"`);
    return ((xml.slice(0, blip.index) + tag + xml.slice(blip.index + blip[0].length))
        .replace(/<a:srcRect\b[^>]*\/>/, '')
        // The replacement is always raster and Word prefers a leftover Office-2016
        // <asvg:svgBlip> extension over the retargeted r:embed — drop the extension
        .replace(/<a:ext\b[^>]*>\s*<\w+:svgBlip\b[\s\S]*?<\/a:ext>/, '')
        .replace(/<a:extLst>\s*<\/a:extLst>/, ''));
}
