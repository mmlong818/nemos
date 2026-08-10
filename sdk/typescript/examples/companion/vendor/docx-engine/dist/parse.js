"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertZipWithinLimits = assertZipWithinLimits;
exports.parseDocx = parseDocx;
const jszip_1 = __importDefault(require("jszip"));
const chart_1 = require("./chart");
const ink_1 = require("./ink");
const list_markers_1 = require("./list-markers");
const metafile_1 = require("./metafile");
const math_1 = require("./math");
const generate_1 = require("./generate");
const notes_1 = require("./notes");
const scan_1 = require("./scan");
const sources_1 = require("./sources");
const symbol_fonts_1 = require("./symbol-fonts");
const theme_1 = require("./theme");
const types_1 = require("./types");
const watermark_1 = require("./watermark");
const xml_utils_1 = require("./xml-utils");
const MAX_ZIP_PARTS = 10000;
const MAX_PART_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1.5 * 1024 * 1024 * 1024;
/**
 * Reject zip bombs before any part is inflated, using the declared
 * uncompressed sizes from the central directory (JSZip keeps them in
 * the lazy `_data` compressed object).
 */
function assertZipWithinLimits(zip) {
    const files = Object.values(zip.files).filter((f) => !f.dir);
    if (files.length > MAX_ZIP_PARTS) {
        throw new Error(`docx rejected: ${files.length} parts exceeds the ${MAX_ZIP_PARTS} limit`);
    }
    let total = 0;
    for (const file of files) {
        const size = file._data?.uncompressedSize ?? 0;
        if (size > MAX_PART_UNCOMPRESSED_BYTES) {
            throw new Error(`docx rejected: part ${file.name} declares ${size} uncompressed bytes ` +
                `(limit ${MAX_PART_UNCOMPRESSED_BYTES})`);
        }
        if (size > 0)
            total += size;
    }
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(`docx rejected: total uncompressed size ${total} exceeds the ` +
            `${MAX_TOTAL_UNCOMPRESSED_BYTES} limit`);
    }
}
const IMAGE_MIME = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    emf: 'image/emf',
    wmf: 'image/wmf',
    tif: 'image/tiff',
    tiff: 'image/tiff',
};
async function parseDocx(bytes) {
    const zip = await jszip_1.default.loadAsync(bytes);
    assertZipWithinLimits(zip);
    const docFile = zip.file('word/document.xml');
    if (!docFile)
        throw new Error('not a docx: missing word/document.xml');
    const documentXml = await docFile.async('string');
    const theme = await parseTheme(zip);
    const { styles, docDefaults } = await parseStyles(zip, theme.colors, theme.fonts);
    const headingStyleIds = new Map();
    let listParagraphStyleId;
    for (const info of styles.values()) {
        if (info.headingLevel && !headingStyleIds.has(info.headingLevel)) {
            headingStyleIds.set(info.headingLevel, info.styleId);
        }
        if (!listParagraphStyleId && /^listparagraph$/i.test(info.styleId)) {
            listParagraphStyleId = info.styleId;
        }
    }
    const rels = await parseRels(zip, 'word/_rels/document.xml.rels');
    const { formats: numFormats, defs: numbering } = await parseNumbering(zip);
    const comments = await parseComments(zip);
    const protection = await parseProtection(zip);
    const footnotes = await parseNotesPart(zip, 'footnote');
    const endnotes = await parseNotesPart(zip, 'endnote');
    const sources = await parseSources(zip);
    // display numbers for note reference markers, by part order
    const noteNumbers = new Map();
    footnotes.forEach((n, i) => noteNumbers.set(`footnote:${n.id}`, i + 1));
    endnotes.forEach((n, i) => noteNumbers.set(`endnote:${n.id}`, i + 1));
    const scan = (0, scan_1.scanBody)(documentXml);
    const mediaByRid = await tableBlipMedia(scan.elements, documentXml, zip, rels);
    const elements = [];
    const blocks = [];
    const chartParts = {};
    const buildCtx = {
        zip,
        styles,
        rels,
        numFormats,
        numbering,
        chartParts,
        noteNumbers,
        themeColors: theme.colors,
        themeFonts: theme.fonts,
        mediaByRid,
    };
    let sdtGroupSeq = 0;
    for (const el of scan.elements) {
        const xml = documentXml.slice(el.start, el.end);
        const sdtParts = el.name === 'w:sdt' ? splitSdtParts(xml) : null;
        if (sdtParts) {
            const meta = sdtMeta(xml);
            const group = sdtGroupSeq++;
            for (const part of sdtParts) {
                const i = elements.length;
                elements.push({ name: part.name, start: el.start + part.start, end: el.start + part.end });
                const childXml = xml.slice(part.childStart, part.childEnd);
                const block = await buildBlock({ name: part.name, start: 0, end: childXml.length }, i, childXml, buildCtx);
                block.originalXml = xml.slice(part.start, part.end);
                block.sdtShell = {
                    ...meta,
                    openXml: xml.slice(part.start, part.childStart),
                    closeXml: xml.slice(part.childEnd, part.end),
                    group,
                };
                if (!block.label)
                    block.label = meta.alias || meta.tag || 'Content control';
                blocks.push(block);
            }
            continue;
        }
        const i = elements.length;
        elements.push(el);
        blocks.push(await buildBlock(el, i, xml, buildCtx));
    }
    applyTocEntryNumbers(blocks, numbering);
    const header = await readHeaderFooterPart(zip, documentXml, rels, 'header', 'default', theme.colors);
    const footer = await readHeaderFooterPart(zip, documentXml, rels, 'footer', 'default', theme.colors);
    const headerFirst = await readHeaderFooterPart(zip, documentXml, rels, 'header', 'first', theme.colors);
    const footerFirst = await readHeaderFooterPart(zip, documentXml, rels, 'footer', 'first', theme.colors);
    const headerEven = await readHeaderFooterPart(zip, documentXml, rels, 'header', 'even', theme.colors);
    const footerEven = await readHeaderFooterPart(zip, documentXml, rels, 'footer', 'even', theme.colors);
    const titlePg = /<w:titlePg\s*\/>/.test(documentXml);
    const evenAndOddHeaders = await parseEvenAndOddHeaders(zip);
    const hfParts = await parseAllHfParts(zip, rels, theme.colors);
    // ink annotations (freehand strokes): our own anchored floating pictures, restored
    // into an editable overlay layer instead of being shown as image blocks
    const inks = [];
    for (const block of blocks) {
        if (block.docxIndex === null || !block.originalXml)
            continue;
        for (const run of (0, ink_1.findInkRuns)(block.originalXml)) {
            inks.push({
                anchorIndex: block.docxIndex,
                offsetXPx: run.offsetXPx,
                offsetYPx: run.offsetYPx,
                widthPx: run.widthPx,
                heightPx: run.heightPx,
                dataUrl: run.embedRId ? await mediaDataUrl(zip, rels, run.embedRId) : null,
                payload: run.payload,
            });
        }
    }
    return {
        blocks,
        comments,
        protection,
        footnotes,
        endnotes,
        sources,
        inks,
        themeFonts: theme.fonts,
        themeColors: theme.colors,
        watermarkText: header?.watermark ?? null,
        headerText: header?.text ?? null,
        headerParas: header?.paras ?? null,
        footerParas: footer?.paras ?? null,
        headerImages: header?.images ?? null,
        footerImages: footer?.images ?? null,
        footerText: footer?.text ?? null,
        footerHasPageNumber: footer?.hasPageNumber ?? false,
        headerHasPageNumber: header?.hasPageNumber ?? false,
        titlePg,
        evenAndOddHeaders,
        headerFirst: hfPartInfo(headerFirst),
        footerFirst: hfPartInfo(footerFirst),
        headerEven: hfPartInfo(headerEven),
        footerEven: hfPartInfo(footerEven),
        hfParts,
        styles,
        docDefaults,
        headingStyleIds,
        listParagraphStyleId,
        numbering,
        internal: {
            originalBytes: bytes,
            documentXml,
            bodyInnerStart: scan.innerStart,
            bodyInnerEnd: scan.innerEnd,
        },
        extras: { elements, chartParts },
    };
}
/** numbering reference of a paragraph: direct w:numPr, falling back to the pStyle's
 * numPr (ListBullet/ListNumber style-driven lists carry no numPr on the paragraph).
 * numId="0" is Word's explicit "no numbering" and yields undefined. */
function listRefOf(ctx, pPr, styleId) {
    const numPr = pPr ? (0, xml_utils_1.findChild)(pPr, 'w:numPr') : undefined;
    const directNumId = numPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(numPr, 'w:numId') ?? {})['w:val'] : undefined;
    const directIlvl = numPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(numPr, 'w:ilvl') ?? {})['w:val'] : undefined;
    if (directNumId === '0')
        return undefined;
    const styleNumPr = styleId ? ctx.styles.get(styleId)?.numPr : undefined;
    const numId = directNumId ?? styleNumPr?.numId;
    if (!numId)
        return undefined;
    const ilvl = directIlvl !== undefined ? parseInt(directIlvl, 10) || 0 : (styleNumPr?.ilvl ?? 0);
    return { numId, ilvl };
}
/** bullet/ordered classification of one list level (mixed lists differ per ilvl) */
function listKindOf(ctx, numId, ilvl) {
    const fmt = ctx.numbering.get(numId)?.levels[ilvl]?.numFmt;
    if (fmt !== undefined)
        return fmt === 'bullet' ? 'bullet' : 'ordered';
    return ctx.numFormats.get(numId) ?? 'bullet';
}
/** w:color -> display hex; w:themeColor resolves against the live palette (beats stale w:val) */
function colorFrom(container, theme) {
    if (!container)
        return undefined;
    const a = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(container, 'w:color') ?? {});
    if (a['w:themeColor'] && theme) {
        const resolved = (0, theme_1.resolveThemeColor)(a['w:themeColor'], theme, a['w:themeTint'], a['w:themeShade']);
        if (resolved)
            return resolved;
    }
    const val = a['w:val'];
    return val && val !== 'auto' ? val : undefined;
}
/**
 * Extract a SdtShell from a raw <w:sdt>…</w:sdt> XML string.
 * Returns the shell metadata + the first <w:p> found in <w:sdtContent>,
 * or null if no usable paragraph is found.
 */
function parseSdtBlock(sdtXml) {
    // --- find the sdtContent region ---
    // sdtContent is a direct child of w:sdt; its content may be a w:p or w:tbl
    const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
    if (!contentOpen)
        return null;
    const contentTagEnd = contentOpen.index + contentOpen[0].length;
    // find the matching </w:sdtContent>
    const contentClose = sdtXml.indexOf('</w:sdtContent>', contentTagEnd);
    if (contentClose === -1)
        return null;
    // extract the first w:p inside sdtContent
    const innerContent = sdtXml.slice(contentTagEnd, contentClose);
    const pStart = innerContent.search(/<w:p[\s/>]/);
    if (pStart === -1)
        return null;
    // find matching closing </w:p>
    let depth = 0;
    let pEnd = -1;
    const tagRe = /<\/?w:p(?=[\s/>])/g;
    let m;
    while ((m = tagRe.exec(innerContent)) !== null) {
        if (m[0].startsWith('</')) {
            if (depth === 1) {
                pEnd = m.index + m[0].length + 1; // include '>'
                break;
            }
            depth--;
        }
        else {
            depth++;
        }
    }
    if (pEnd === -1) {
        // self-closing <w:p/> or no </w:p> found — unlikely but safe
        const selfClose = /<w:p\/>/.exec(innerContent);
        pEnd = selfClose ? selfClose.index + selfClose[0].length : innerContent.length;
    }
    const pXml = innerContent.slice(pStart, pEnd);
    // openXml = everything from start of sdt to end of <w:sdtContent> open tag
    const openXml = sdtXml.slice(0, contentTagEnd);
    const closeXml = sdtXml.slice(contentClose); // "</w:sdtContent></w:sdt>"
    return {
        shell: { ...sdtMeta(sdtXml), openXml, closeXml },
        pXml,
    };
}
function sdtMeta(sdtXml) {
    const sdtPrXml = /<w:sdtPr>([\s\S]*?)<\/w:sdtPr>/.exec(sdtXml)?.[1] ?? '';
    const alias = /w:val="([^"]*)"/.exec(/<w:alias[^>]*>/.exec(sdtPrXml)?.[0] ?? '')?.[1] ?? '';
    const tag = /w:val="([^"]*)"/.exec(/<w:tag[^>]*>/.exec(sdtPrXml)?.[0] ?? '')?.[1] ?? '';
    let controlType = 'text';
    if (/<w:date[\s/>]/.test(sdtPrXml))
        controlType = 'date';
    else if (/<w:dropDownList[\s/>]|<w:comboBox[\s/>]/.test(sdtPrXml))
        controlType = 'dropdown';
    else if (/<w:checkbox[\s/>]/.test(sdtPrXml))
        controlType = 'checkbox';
    else if (/<w:text[\s/>]|<w:richText[\s/>]/.test(sdtPrXml))
        controlType = 'text';
    return { alias, tag, controlType };
}
/**
 * When <w:sdtContent> holds several top-level w:p / w:tbl children (Word TOC,
 * multi-paragraph rich-text controls), each child becomes its own block.
 * Returns null for 0-1 children (single-block path keeps its behavior).
 */
function splitSdtParts(sdtXml) {
    const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
    if (!contentOpen)
        return null;
    const innerStart = contentOpen.index + contentOpen[0].length;
    const innerEnd = sdtXml.lastIndexOf('</w:sdtContent>');
    if (innerEnd <= innerStart)
        return null;
    const children = [];
    const tagRe = /<(\/?)([A-Za-z0-9:._-]+)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
    tagRe.lastIndex = innerStart;
    let depth = 0;
    let start = -1;
    let name = '';
    let m;
    while ((m = tagRe.exec(sdtXml)) !== null && m.index < innerEnd) {
        if (m[1] === '/') {
            depth--;
            if (depth === 0)
                children.push({ name, start, end: m.index + m[0].length });
        }
        else if (m[3].endsWith('/')) {
            if (depth === 0)
                children.push({ name: m[2], start: m.index, end: m.index + m[0].length });
        }
        else {
            if (depth === 0) {
                start = m.index;
                name = m[2];
            }
            depth++;
        }
    }
    const parts = children.filter((c) => c.name === 'w:p' || c.name === 'w:tbl');
    if (parts.length < 2)
        return null;
    return parts.map((c, k) => ({
        name: c.name,
        start: k === 0 ? 0 : c.start,
        end: k === parts.length - 1 ? sdtXml.length : parts[k + 1].start,
        childStart: c.start,
        childEnd: c.end,
    }));
}
/**
 * When a top-level <w:sdt>'s content begins with a table (no paragraph before
 * it), return the balanced <w:tbl>…</w:tbl> slice, else null.
 */
function sdtTableXml(sdtXml) {
    const contentOpen = /<w:sdtContent(?:\s[^>]*)?>/.exec(sdtXml);
    if (!contentOpen)
        return null;
    const contentTagEnd = contentOpen.index + contentOpen[0].length;
    const contentClose = sdtXml.lastIndexOf('</w:sdtContent>');
    if (contentClose <= contentTagEnd)
        return null;
    const inner = sdtXml.slice(contentTagEnd, contentClose);
    const tblStart = inner.search(/<w:tbl[\s>]/);
    if (tblStart === -1)
        return null;
    const pStart = inner.search(/<w:p[\s/>]/);
    if (pStart !== -1 && pStart < tblStart)
        return null;
    // balanced </w:tbl> for the opening tag (tables can nest)
    let depth = 0;
    const tagRe = /<\/?w:tbl(?=[\s/>])/g;
    tagRe.lastIndex = tblStart;
    let m;
    while ((m = tagRe.exec(inner)) !== null) {
        if (m[0].startsWith('</')) {
            depth--;
            if (depth === 0)
                return inner.slice(tblStart, m.index + '</w:tbl>'.length);
        }
        else
            depth++;
    }
    return null;
}
/** Range/marker elements that are invisible in Word when they land at body top level */
const INVISIBLE_BODY_MARKERS = new Set([
    'w:bookmarkStart',
    'w:bookmarkEnd',
    'w:commentRangeStart',
    'w:commentRangeEnd',
    'w:proofErr',
    'w:permStart',
    'w:permEnd',
    'w:moveFromRangeStart',
    'w:moveFromRangeEnd',
    'w:moveToRangeStart',
    'w:moveToRangeEnd',
    'w:customXmlInsRangeStart',
    'w:customXmlInsRangeEnd',
    'w:customXmlDelRangeStart',
    'w:customXmlDelRangeEnd',
]);
async function buildBlock(el, index, xml, ctx) {
    const base = { id: `b${index}`, docxIndex: index, originalXml: xml };
    if (el.name === 'w:ins' || el.name === 'w:del') {
        const openEnd = xml.indexOf('>') + 1;
        const closeStart = xml.lastIndexOf(`</${el.name}>`);
        const child = (0, generate_1.splitXmlChildren)(xml.slice(openEnd, closeStart)).find((entry) => entry.name === 'w:p' || entry.name === 'w:tbl');
        if (child) {
            const inner = await buildBlock({ name: child.name, start: 0, end: child.xml.length }, index, child.xml, ctx);
            let revisionAttrs = {};
            try {
                const parsed = xml_utils_1.xmlParser.parse(xml);
                const revisionNode = parsed.find((node) => (0, xml_utils_1.nameOf)(node) === el.name);
                if (revisionNode)
                    revisionAttrs = (0, xml_utils_1.attrsOf)(revisionNode);
            }
            catch {
                /* malformed wrapper remains a protected passthrough */
            }
            inner.originalXml = xml;
            inner.blockRevision = {
                kind: el.name === 'w:ins' ? 'ins' : 'del',
                author: revisionAttrs['w:author'] ?? '',
                ...(revisionAttrs['w:date'] ? { date: revisionAttrs['w:date'] } : {}),
                ...(revisionAttrs['w:id'] ? { id: revisionAttrs['w:id'] } : {}),
            };
            return inner;
        }
    }
    if (el.name === 'w:sectPr') {
        return { ...base, type: 'passthrough', label: 'Section properties', hidden: true };
    }
    if (el.name === 'w:tbl') {
        return { ...base, type: 'table', ...tableSummary(xml), table: extractTable(xml, ctx) };
    }
    // --- SDT (structured document tag): extract sdtContent paragraph as editable ---
    if (el.name === 'w:sdt') {
        // sdtContent that starts with a table (research-report templates wrap whole
        // tables in content controls): display as a real table. Untouched
        // it saves byte-identical; cell-text edits patch inside the sdt shell.
        const tblXml = sdtTableXml(xml);
        if (tblXml) {
            return { ...base, type: 'table', ...tableSummary(tblXml), table: extractTable(tblXml, ctx) };
        }
        const sdtResult = parseSdtBlock(xml);
        if (sdtResult) {
            const { shell, pXml } = sdtResult;
            // Build a synthetic BodyElement for the inner w:p
            const syntheticEl = { name: 'w:p', start: 0, end: pXml.length };
            // Build the block from the inner paragraph XML (keeps the sdt originalXml for passthrough)
            const innerBlock = await buildBlock(syntheticEl, index, pXml, ctx);
            // Attach the sdt shell and preserve the full sdt XML as the original
            innerBlock.originalXml = xml;
            innerBlock.sdtShell = shell;
            // Label the block with the alias for UI affordance
            if (!innerBlock.label) {
                const aliasLabel = shell.alias || shell.tag || 'Content control';
                innerBlock.label = aliasLabel;
            }
            return innerBlock;
        }
        // No usable paragraph found → passthrough
        return { ...base, type: 'passthrough', label: 'Content control', previewText: '' };
    }
    if (INVISIBLE_BODY_MARKERS.has(el.name)) {
        return { ...base, type: 'passthrough', label: el.name, invisibleMarker: true };
    }
    if (el.name !== 'w:p') {
        return { ...base, type: 'passthrough', label: el.name, previewText: '' };
    }
    // Feature-detect on XML with mc:Fallback stripped: Word pairs every modern
    // DrawingML shape (mc:Choice) with a legacy VML twin (<mc:Fallback><w:pict>),
    // so matching the raw bytes would misclassify every decorated paragraph as an
    // embedded object. Only detection uses this; saving still passes through the
    // original bytes untouched.
    // aidocs-ink runs are parsed separately into ParsedDoc.inks and re-emitted
    // from the save options; hide them from detection so an annotated text
    // paragraph stays an editable paragraph instead of a protected drawing.
    const detect = (0, ink_1.stripInkRuns)(xml.includes('<mc:Fallback') ? xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '') : xml);
    // Paragraph: certain constructs are protected as whole passthrough blocks.
    // Regenerating them would silently drop structure (section breaks, fields,
    // footnote anchors...), which is exactly the kind of damage patch-save exists
    // to prevent.
    if (detect.includes('<w:sectPr')) {
        return {
            ...base,
            type: 'passthrough',
            label: 'Section break paragraph',
            previewText: plainText(detect),
        };
    }
    // Field chars inside textbox content don't make the paragraph itself a field
    // paragraph: research-report sidebars are VML textboxes embedding PAGE/date
    // fields, and those paragraphs must reach the textbox display path below
    //. Textbox blocks are protected passthrough anyway.
    const fieldDetect = detect.includes('<w:txbxContent') ? stripTextboxes(detect) : detect;
    const hasFields = fieldDetect.includes('<w:fldChar') ||
        fieldDetect.includes('<w:fldSimple') ||
        fieldDetect.includes('<w:instrText');
    // Field paragraphs whose visible result is a picture (e.g. INCLUDEPICTURE)
    // should still display the image; the block stays protected either way.
    // Non-field drawing paragraphs take the drawing branch below, which keeps
    // mixed text + inline-image paragraphs editable.
    if (hasFields &&
        detect.includes('<w:drawing') &&
        !detect.includes('<c:chart') &&
        !detect.includes('r:dm=') &&
        !detect.includes('<dgm:')) {
        const image = await extractImage(detect, ctx);
        if (image) {
            return { ...base, type: 'image', label: 'Image', imageDataUrl: image, ...imageMeta(detect) };
        }
    }
    if (hasFields) {
        // XE (index entry) fields are invisible markers; a paragraph whose only
        // fields are XE stays editable (extractRuns round-trips the markers).
        if (!onlyXeFields(detect)) {
            return {
                ...base,
                type: 'passthrough',
                label: fieldLabel(xml),
                previewText: plainText(xml),
                fieldDisplay: fieldDisplayOf(xml),
            };
        }
    }
    // TOC-styled paragraphs are part of a TOC field result even when they carry
    // no field chars themselves (entries with literal page numbers). Editing
    // them individually would corrupt the field, so they stay protected.
    // Word writes styleIds "TOC1".."TOC9"; Pages exports "TOC 1"/"TOC 2" (with space).
    if (/<w:pStyle w:val="TOC ?[1-9]"/.test(xml)) {
        return {
            ...base,
            type: 'passthrough',
            label: 'TOC entry',
            previewText: plainText(xml),
            fieldDisplay: fieldDisplayOf(xml),
        };
    }
    // footnote / endnote references are editable: extractRuns turns them into
    // Run.noteRef markers that regenerate as w:footnoteReference / w:endnoteReference
    // Run-level w:ins / w:del are parsed into Run.ins / Run.del (editable).
    // Paragraph-property revisions (pPrChange / numberingChange / paragraph-mark
    // ins/del) live in pPr and survive editing via Block.rawPPr passthrough.
    // moveFrom / moveTo are now parsed as editable with move-revision markers.
    // Only run-level revision constructs the run model cannot round-trip stay
    // protected: run-property changes, deleted field instructions, table-cell ins/del.
    if (/<w:(delInstrText|cellIns|cellDel)[ />]/.test(detect)) {
        return {
            ...base,
            type: 'passthrough',
            label: 'Revised paragraph',
            previewText: plainText(detect),
        };
    }
    // display equations (oMathPara / math-only paragraphs) stay protected as a
    // whole; paragraphs mixing math with plain text fall through to
    // buildTextParagraph, where each m:oMath becomes an atomic inline math run
    if (detect.includes('<m:oMath') &&
        (detect.includes('<m:oMathPara') || plainText(detect).trim() === '')) {
        const tokens = mathTokens(detect);
        const omml = (0, math_1.ommlFragmentsOf)(detect).join('');
        // 2D MathML only for pure equations; an oMathPara paragraph that also has
        // plain runs keeps the flat token strip so the surrounding text stays visible
        const mathml = plainText(detect).trim() === '' ? (0, math_1.ommlToMathML)(omml) : '';
        const latex = omml ? (0, math_1.ommlToLatex)(omml) : null;
        return {
            ...base,
            type: 'passthrough',
            label: 'Equation',
            previewText: tokens.join(''),
            formulaDisplay: {
                tokens,
                ...(mathml ? { mathml } : {}),
                ...(omml ? { omml } : {}),
                ...(latex ? { latex } : {}),
            },
        };
    }
    if (detect.includes('<w:object') || detect.includes('<w:pict')) {
        // Legacy VML textboxes (v:shape/v:textbox in w:pict): extract the
        // structured display model instead of flattening every nested paragraph and
        // table into one unreadable run. w:object (OLE) keeps the plain preview.
        if (!detect.includes('<w:object') && detect.includes('<w:txbxContent')) {
            const textboxes = extractTextboxes(detect, ctx);
            if (textboxes.length > 0 && plainText(stripTextboxes(detect)).trim() === '') {
                return {
                    ...base,
                    type: 'passthrough',
                    label: 'Text box',
                    previewText: textboxes
                        .flatMap((t) => t.paras.map((p) => p.runs.map((r) => r.text).join('')))
                        .join('\n'),
                    textboxes,
                };
            }
        }
        return {
            ...base,
            type: 'passthrough',
            label: 'Embedded object',
            previewText: plainText(detect),
            ...(await oleDisplay(detect, ctx)),
        };
    }
    if (detect.includes('<w:drawing')) {
        if (detect.includes('<c:chart') || detect.includes('r:dm=') || detect.includes('<dgm:')) {
            const isChart = detect.includes('<c:chart');
            const chartDisplay = isChart ? await extractChart(detect, ctx) : null;
            const diagramText = isChart ? null : await extractDiagramText(detect, ctx);
            return {
                ...base,
                type: 'passthrough',
                label: isChart ? 'Chart' : 'SmartArt',
                ...(chartDisplay ? { chartDisplay, previewText: chartDisplay.title ?? '' } : {}),
                ...(diagramText ? { previewText: diagramText } : {}),
            };
        }
        const image = await extractImage(detect, ctx);
        if (image) {
            // inline picture(s) sharing the paragraph with real text: an image block
            // would silently drop that text, so keep the paragraph editable with
            // run-level images. Anchored pictures keep the image-block treatment.
            if (!detect.includes('<wp:anchor') && plainText(stripTextboxes(detect)).trim() !== '') {
                await resolveBlipMedia(detect, ctx);
                return buildTextParagraph(base, xml, ctx, true);
            }
            return { ...base, type: 'image', label: 'Image', imageDataUrl: image, ...imageMeta(detect) };
        }
        const textboxes = extractTextboxes(detect, ctx);
        const boxTexts = textboxes.flatMap((t) => t.paras.map((p) => p.runs.map((r) => r.text).join('')));
        const strayText = plainText(stripTextboxes(detect)).trim();
        // Anchored decorative shape (underline rule, background box...) in a
        // paragraph that also carries real text: parse it as a normal paragraph so
        // the text stays readable/editable. The shape lives in runs we do not
        // regenerate — the block still saves byte-identical while untouched, and
        // only loses the decoration if the user actually edits this paragraph.
        // Content-carrying textboxes are the exception: the plain-paragraph path
        // would silently drop their text, so the block stays a textbox passthrough
        // (the stray text joins the preview instead of vanishing).
        if (strayText !== '' && !boxTexts.some((t) => t.trim() !== '')) {
            return buildTextParagraph(base, xml, ctx);
        }
        // Anchored textboxes (code boxes, callout cards): all visible text lives in
        // w:txbxContent. Extract a display-only model so content and box styling
        // render; the block stays protected and saves byte-identical.
        if (textboxes.length > 0) {
            return {
                ...base,
                type: 'passthrough',
                label: 'Text box',
                previewText: (strayText !== '' ? [strayText, ...boxTexts] : boxTexts).join('\n'),
                textboxes,
                ...imageMeta(detect),
            };
        }
        // Picture whose media cannot be shown (rel missing / pointing at a
        // non-media part, or metafile conversion failed): empty frame at the
        // declared extent
        // instead of a bare chip. Bytes still pass through untouched.
        if (detect.includes('<a:blip') || detect.includes('<pic:pic')) {
            const docPr = /<wp:docPr [^>]*\/?>/.exec(detect)?.[0] ?? '';
            const alt = /\bdescr="([^"]+)"/.exec(docPr)?.[1] ?? /\bname="([^"]+)"/.exec(docPr)?.[1];
            return {
                ...base,
                type: 'passthrough',
                label: 'Image',
                brokenImage: true,
                ...(alt ? { previewText: decodeEntities(alt) } : {}),
                ...imageMeta(detect),
            };
        }
        if (isInvisibleEmptyShape(detect)) {
            return { ...base, type: 'passthrough', label: 'Drawing object', invisibleMarker: true };
        }
        const decorative = isThinRule(detect);
        return {
            ...base,
            type: 'passthrough',
            label: 'Drawing object',
            decorative,
            ...(decorative ? ruleDisplayOf(detect) : {}),
        };
    }
    return buildTextParagraph(base, xml, ctx);
}
/**
 * Effective heading level 1-9 (Word TOC/outline semantics): direct pPr
 * w:outlineLvl wins (9 = body text), then the style's level, then a built-in
 * HeadingN styleId the document never defined.
 */
function headingLevelOf(pPr, styleId, ctx) {
    const direct = pPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:outlineLvl') ?? {})['w:val'] : undefined;
    if (direct !== undefined) {
        const lvl = parseInt(direct, 10);
        return lvl >= 0 && lvl <= 8 ? lvl + 1 : undefined;
    }
    if (!styleId)
        return undefined;
    const info = ctx.styles.get(styleId);
    if (info)
        return info.headingLevel;
    const m = /^Heading([1-9])$/i.exec(styleId);
    return m ? parseInt(m[1], 10) : undefined;
}
/** parse a w:p as editable text content (paragraph / heading / listItem) */
function buildTextParagraph(base, xml, ctx, withImages = false) {
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(xml);
    }
    catch {
        // unparseable paragraph (e.g. pathological nesting): keep the original bytes
        return { ...base, type: 'passthrough', label: 'Paragraph', previewText: plainText(xml) };
    }
    const pNode = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:p');
    if (!pNode) {
        return { ...base, type: 'passthrough', label: 'Unknown paragraph', previewText: plainText(xml) };
    }
    const pPr = (0, xml_utils_1.findChild)(pNode, 'w:pPr');
    const styleId = pPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:pStyle') ?? {})['w:val'] : undefined;
    let format = pPr ? extractParaFormat(pPr) : undefined;
    // style-chain autoSpace off reaches the block: the renderer reads it per paragraph
    if (format?.autoSpace === undefined && styleId) {
        if (ctx.styles.get(styleId)?.display?.autoSpace === false) {
            format = { ...(format ?? {}), autoSpace: false };
        }
    }
    const rawPPr = rawPPrOf(xml);
    // inline math: raw <m:oMath> fragments in document order, aligned with the
    // walk below (strip fallback/textbox copies so indexes match visited nodes)
    const mathXml = stripTextboxes(xml.includes('<mc:Fallback') ? xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '') : xml);
    const runs = extractRuns(pNode, ctx, (0, math_1.ommlFragmentsOf)(mathXml), rubyFragmentsOf(mathXml), withImages);
    const { bookmarks, hiddenBookmarks } = bookmarkNamesOf(stripTextboxes(xml));
    const { commentStarts, commentEnds } = crossParaCommentMarkers(stripTextboxes(xml));
    // --- move revision detection ---
    // A paragraph with moveFrom/moveTo at run level gets a block-level marker
    // for visual styling (strikethrough+red bg for moveFrom, green bg for moveTo).
    let moveRevision;
    if (/<w:moveFrom[\s/>]/.test(xml))
        moveRevision = 'from';
    else if (/<w:moveTo[\s/>]/.test(xml))
        moveRevision = 'to';
    // --- pPrChange info extraction ---
    // When the paragraph has a pPrChange (tracked format change), extract the
    // revision author/date/id for the review badge and navigation.
    let pPrChangeInfo;
    if (pPr) {
        const pPrChangeEl = (0, xml_utils_1.findChild)(pPr, 'w:pPrChange');
        if (pPrChangeEl) {
            const attrs = (0, xml_utils_1.attrsOf)(pPrChangeEl);
            pPrChangeInfo = { author: attrs['w:author'] ?? '' };
            if (attrs['w:date'])
                pPrChangeInfo.date = attrs['w:date'];
            if (attrs['w:id'])
                pPrChangeInfo.id = attrs['w:id'];
            const oldPPr = (0, xml_utils_1.findChild)(pPrChangeEl, 'w:pPr');
            if (oldPPr) {
                const old = {
                    ...(extractParaFormat(oldPPr) ?? {}),
                };
                const oldStyleId = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldPPr, 'w:pStyle') ?? {})['w:val'];
                if (oldStyleId)
                    old.styleId = oldStyleId;
                const oldNumPr = (0, xml_utils_1.findChild)(oldPPr, 'w:numPr');
                const oldNumId = oldNumPr
                    ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldNumPr, 'w:numId') ?? {})['w:val']
                    : undefined;
                if (oldNumId) {
                    old.type = 'docListItem';
                    old.numId = oldNumId;
                    old.ilvl =
                        parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldNumPr, 'w:ilvl') ?? {})['w:val'] ?? '0', 10) || 0;
                    old.kind = listKindOf(ctx, oldNumId, old.ilvl);
                }
                else {
                    const oldLevel = headingLevelOf(oldPPr, oldStyleId, ctx);
                    if (oldLevel) {
                        old.type = 'docHeading';
                        old.level = oldLevel;
                    }
                    else if (oldStyleId) {
                        old.type = 'docParagraph';
                    }
                }
                if (old && Object.keys(old).length > 0)
                    pPrChangeInfo.old = old;
            }
        }
    }
    // list item?
    const listRef = listRefOf(ctx, pPr, styleId);
    /** extra revision fields shared across all return paths */
    const revExtras = {
        ...(moveRevision ? { moveRevision } : {}),
        ...(pPrChangeInfo ? { pPrChangeInfo } : {}),
    };
    if (listRef) {
        const kind = listKindOf(ctx, listRef.numId, listRef.ilvl);
        return {
            ...base,
            type: 'listItem',
            styleId,
            list: { kind, numId: listRef.numId, ilvl: listRef.ilvl },
            format,
            rawPPr,
            bookmarks,
            hiddenBookmarks,
            commentStarts,
            commentEnds,
            runs,
            ...revExtras,
        };
    }
    // heading?
    const headingLevel = headingLevelOf(pPr, styleId, ctx);
    if (headingLevel) {
        return {
            ...base,
            type: 'heading',
            level: headingLevel,
            styleId,
            format,
            rawPPr,
            bookmarks,
            hiddenBookmarks,
            commentStarts,
            commentEnds,
            runs,
            ...revExtras,
        };
    }
    return {
        ...base,
        type: 'paragraph',
        styleId,
        format,
        rawPPr,
        bookmarks,
        hiddenBookmarks,
        commentStarts,
        commentEnds,
        runs,
        ...revExtras,
    };
}
/**
 * Cross-paragraph comment range endpoints: comment ids where only one end falls in this
 * paragraph (the other end is in a different paragraph). Ranges fully within one
 * paragraph are handled by run.commentIds; this only catches cross-paragraph ones so a
 * paragraph rebuild does not leave orphaned commentRangeEnd/Start markers.
 */
function crossParaCommentMarkers(xml) {
    const ids = (re) => [...xml.matchAll(re)].map((m) => m[1]);
    const starts = ids(/<w:commentRangeStart [^>]*w:id="([^"]+)"/g);
    const ends = ids(/<w:commentRangeEnd [^>]*w:id="([^"]+)"/g);
    const onlyStarts = starts.filter((id) => !ends.includes(id));
    const onlyEnds = ends.filter((id) => !starts.includes(id));
    return {
        commentStarts: onlyStarts.length ? onlyStarts : undefined,
        commentEnds: onlyEnds.length ? onlyEnds : undefined,
    };
}
/** user bookmark names starting in this paragraph; Word internals (_Toc/_Ref/_GoBack…) split out as hiddenBookmarks */
function bookmarkNamesOf(xml) {
    const names = [];
    const hidden = [];
    for (const m of xml.matchAll(/<w:bookmarkStart [^>]*w:name="([^"]+)"/g)) {
        const name = decodeEntities(m[1]);
        // A _ prefix marks Word internal bookmarks (_Ref/_Toc/_Hlk): hidden from the UI, but
        // they must be re-emitted when the paragraph rebuilds, otherwise REF cross-references
        // and TOC anchors pointing at them break
        const list = name.startsWith('_') ? hidden : names;
        if (!list.includes(name))
            list.push(name);
    }
    return {
        bookmarks: names.length > 0 ? names : undefined,
        hiddenBookmarks: hidden.length > 0 ? hidden : undefined,
    };
}
/**
 * Exact <w:pPr>...</w:pPr> slice of a paragraph (depth-aware: pPrChange nests
 * another w:pPr inside). undefined when the paragraph has no properties.
 */
function rawPPrOf(xml) {
    // the paragraph's own pPr must be the first child of w:p; a later match
    // would belong to nested content (textbox paragraphs)
    const openEnd = xml.indexOf('>') + 1;
    if (openEnd === 0 || !xml.startsWith('<w:pPr', openEnd))
        return undefined;
    const start = openEnd;
    const re = /<w:pPr(?=[\s/>])|<\/w:pPr>/g;
    re.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = re.exec(xml)) !== null) {
        if (match[0] === '</w:pPr>') {
            depth--;
            if (depth === 0)
                return xml.slice(start, match.index + match[0].length);
        }
        else {
            // self-closing <w:pPr/> never opens
            const gt = xml.indexOf('>', match.index);
            if (xml[gt - 1] === '/') {
                if (depth === 0)
                    return xml.slice(start, gt + 1);
                continue;
            }
            depth++;
        }
    }
    return undefined;
}
/**
 * A text-less anchored shape no taller than ~10px is almost always a
 * decorative horizontal rule (heading underlines, dividers); render those as a
 * line instead of a drawing-object chip.
 */
function isThinRule(xml) {
    const cy = parseInt(/<wp:extent cx="\d+" cy="(\d+)"/.exec(xml)?.[1] ?? '', 10);
    return Number.isFinite(cy) && cy > 0 && cy <= 130000;
}
/** stroke color/thickness (a:ln) + extent width of a decorative rule drawing */
function ruleDisplayOf(xml) {
    const out = {};
    const ln = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(xml)?.[0];
    if (ln) {
        const color = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(ln)?.[1];
        if (color)
            out.ruleColorHex = color.toUpperCase();
        const w = parseInt(/<a:ln\b[^>]*\bw="(\d+)"/.exec(ln)?.[1] ?? '', 10);
        if (Number.isFinite(w) && w > 0)
            out.ruleThicknessPx = Math.max(1, Math.round(w / EMU_PER_PX));
    }
    const cx = parseInt(/<wp:extent cx="(\d+)"/.exec(xml)?.[1] ?? '', 10);
    if (Number.isFinite(cx) && cx > 0)
        out.ruleWidthPx = Math.round(cx / EMU_PER_PX);
    return out;
}
/**
 * Converter artifact: every shape explicitly declares noFill + noFill outline
 * and carries no picture, no text and no effects — Word renders nothing, so
 * the block renders as nothing too (still passthrough, bytes untouched).
 */
function isInvisibleEmptyShape(xml) {
    if (!xml.includes('<wps:wsp') || xml.includes('<a:blip') || plainText(xml).trim() !== '') {
        return false;
    }
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(xml);
    }
    catch {
        return false;
    }
    const shapes = [];
    collectNodes(parsed, 'wps:wsp', shapes);
    if (shapes.length === 0)
        return false;
    return shapes.every((shape) => {
        const spPr = (0, xml_utils_1.findChild)(shape, 'wps:spPr');
        if (!spPr || !(0, xml_utils_1.findChild)(spPr, 'a:noFill'))
            return false;
        const ln = (0, xml_utils_1.findChild)(spPr, 'a:ln');
        if (!ln || !(0, xml_utils_1.findChild)(ln, 'a:noFill'))
            return false;
        const effects = (0, xml_utils_1.findChild)(spPr, 'a:effectLst');
        return !effects || (0, xml_utils_1.childrenOf)(effects).length === 0;
    });
}
/** drop textbox content so "does the paragraph itself have text" checks work */
function stripTextboxes(xml) {
    return xml.includes('<w:txbxContent')
        ? xml.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, '')
        : xml;
}
/** paragraphs (and tables, one display line per row) of a w:txbxContent node */
function txbxContentParas(content, ctx) {
    const out = [];
    for (const child of (0, xml_utils_1.childrenOf)(content)) {
        const name = (0, xml_utils_1.nameOf)(child);
        if (name === 'w:p') {
            const para = { runs: extractRuns(child, ctx) };
            const pPr = (0, xml_utils_1.findChild)(child, 'w:pPr');
            if (pPr)
                Object.assign(para, extractParaFormat(pPr));
            out.push(para);
        }
        else if (name === 'w:tbl') {
            out.push(...txbxTableParas(child, ctx));
        }
        else if (name === 'w:sdt') {
            const inner = (0, xml_utils_1.findChild)(child, 'w:sdtContent');
            if (inner)
                out.push(...txbxContentParas(inner, ctx));
        }
    }
    return out;
}
/**
 * Table inside a textbox (sidebar key-data blocks): the display model has no
 * grid, so render one line per row with the cells spaced apart — readable rows
 * instead of a single concatenated blob. Tables nested inside a
 * cell (research templates wrap analyst info this way) recurse into their own
 * lines after the host row.
 */
function txbxTableParas(tbl, ctx) {
    const out = [];
    for (const tr of (0, xml_utils_1.childrenThroughSdt)(tbl, 'w:tr')) {
        const runs = [];
        const nestedLines = [];
        for (const tc of (0, xml_utils_1.childrenThroughSdt)(tr, 'w:tc')) {
            const cellRuns = [];
            for (const p of (0, xml_utils_1.childrenThroughSdt)(tc, 'w:p')) {
                const pRuns = extractRuns(p, ctx);
                if (pRuns.every((r) => r.text.trim() === ''))
                    continue;
                if (cellRuns.length > 0)
                    cellRuns.push({ text: ' ' });
                cellRuns.push(...pRuns);
            }
            if (!cellRuns.every((r) => r.text.trim() === '')) {
                if (runs.length > 0)
                    runs.push({ text: '\u2002\u2002' });
                runs.push(...cellRuns);
            }
            for (const nested of (0, xml_utils_1.childrenThroughSdt)(tc, 'w:tbl')) {
                nestedLines.push(...txbxTableParas(nested, ctx));
            }
        }
        if (runs.length > 0 || nestedLines.length === 0)
            out.push({ runs });
        out.push(...nestedLines);
    }
    return out;
}
/**
 * w:tbl or w:sdt among the txbxContent children: the display lines no longer
 * map 1:1 onto the w:p segments patch-save rewrites, so the box must stay
 * read-only (editing would drop the table / sdt shells).
 */
function txbxHasStructuredContent(content) {
    return (0, xml_utils_1.childrenOf)(content).some((c) => {
        const n = (0, xml_utils_1.nameOf)(c);
        return n === 'w:tbl' || n === 'w:sdt';
    });
}
/** VML style="width:189.9pt;height:626pt" dimension → CSS px */
function vmlStyleDimPx(style, key) {
    const m = new RegExp(`(?:^|;)\\s*${key}:([0-9.]+)(pt|px|in|mm|cm)?`).exec(style);
    if (!m)
        return undefined;
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v) || v <= 0)
        return undefined;
    const unit = m[2] ?? 'pt';
    const px = unit === 'px'
        ? v
        : unit === 'in'
            ? v * 96
            : unit === 'mm'
                ? (v / 25.4) * 96
                : unit === 'cm'
                    ? (v / 2.54) * 96
                    : (v * 96) / 72;
    return Math.round(px);
}
/** VML color attr ("#dbe5f1", "#dbe5f1 [3204]", "windowText") → hex without '#', or undefined */
function vmlColorHex(value) {
    const m = value && /^#?([0-9a-fA-F]{6})/.exec(value.trim());
    return m ? m[1] : undefined;
}
/**
 * Display-only extraction of anchored textboxes: DrawingML (wps:wsp, converter
 * output for code boxes / callout cards) and legacy VML (v:shape etc. inside
 * w:pict, common in broker research templates). Expects
 * fallback-stripped XML, otherwise the mc:Fallback VML twin would duplicate
 * every box.
 */
const LINE_PRSTS_RE = /<a:prstGeom[^>]*prst="(?:line|straightConnector1|bentConnector[234]|curvedConnector[234])"/;
/** stroke-only line/connector prsts shown as display boxes despite no text body */
const LINE_PRSTS = new Set([
    'line',
    'straightConnector1',
    'bentConnector2',
    'bentConnector3',
    'bentConnector4',
    'curvedConnector2',
    'curvedConnector3',
    'curvedConnector4',
]);
/** wps line shape → display-only line box (synthetic prst carries the arrow ends) */
function lineBoxOf(shape) {
    const spPr = (0, xml_utils_1.findChild)(shape, 'wps:spPr');
    if (!spPr)
        return null;
    const prst = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(spPr, 'a:prstGeom') ?? {})['prst'];
    if (!prst || !LINE_PRSTS.has(prst))
        return null;
    const box = { paras: [], readOnly: true };
    const ln = (0, xml_utils_1.findChild)(spPr, 'a:ln');
    const border = ln
        ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(ln, 'a:solidFill') ?? {}, 'a:srgbClr') ?? {})['val']
        : undefined;
    box.borderColor = border ?? '000000';
    const arrowEnd = (name) => {
        const type = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(ln ?? {}, name) ?? {})['type'];
        return !!type && type !== 'none';
    };
    const head = arrowEnd('a:headEnd');
    const tail = arrowEnd('a:tailEnd');
    box.prst = prst.startsWith('bentConnector')
        ? 'lineBent'
        : prst.startsWith('curvedConnector')
            ? 'lineCurved'
            : head && tail
                ? 'lineArrowDouble'
                : head || tail
                    ? 'lineArrow'
                    : 'line';
    const ext = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(spPr, 'a:xfrm') ?? {}, 'a:ext');
    const cx = ext ? parseInt((0, xml_utils_1.attrsOf)(ext)['cx'] ?? '', 10) : NaN;
    const cy = ext ? parseInt((0, xml_utils_1.attrsOf)(ext)['cy'] ?? '', 10) : NaN;
    if (Number.isFinite(cx) && cx > 0)
        box.widthPx = Math.round(cx / EMU_PER_PX);
    if (Number.isFinite(cy) && cy > 0) {
        box.heightPx = Math.round(cy / EMU_PER_PX);
        box.minHeightPx = box.heightPx;
    }
    else {
        // zero-height extent = Word's horizontal line; keep a 12 px grab band
        box.heightPx = 12;
    }
    box.insetTopPx = 0;
    box.insetRightPx = 0;
    box.insetBottomPx = 0;
    box.insetLeftPx = 0;
    return box;
}
/** a:schemeClr val -> ThemeColors slot (DrawingML names; text/bg aliases mapped) */
const SCHEME_CLR_SLOTS = {
    tx1: 'dk1',
    bg1: 'lt1',
    tx2: 'dk2',
    bg2: 'lt2',
    dk1: 'dk1',
    lt1: 'lt1',
    dk2: 'dk2',
    lt2: 'lt2',
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    hlink: 'hlink',
    folHlink: 'folHlink',
};
/** one a:gs stop -> sRGB triple (srgbClr or theme-resolved schemeClr, lumMod/lumOff applied) */
function gradStopRgb(gs, theme) {
    const srgb = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(gs, 'a:srgbClr') ?? {})['val'];
    const scheme = srgb ? undefined : (0, xml_utils_1.findChild)(gs, 'a:schemeClr');
    let base = srgb;
    if (!base && scheme) {
        const slot = SCHEME_CLR_SLOTS[(0, xml_utils_1.attrsOf)(scheme)['val'] ?? ''];
        if (!slot)
            return null;
        base =
            theme?.[slot] ??
                (slot === 'dk1' ? '000000' : slot === 'lt1' ? 'FFFFFF' : undefined);
    }
    if (!base || !/^[0-9A-Fa-f]{6}$/.test(base))
        return null;
    let rgb = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));
    if (scheme) {
        const pct = (name) => {
            const v = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(scheme, name) ?? {})['val'] ?? '', 10);
            return Number.isFinite(v) ? Math.min(100000, Math.max(0, v)) / 100000 : null;
        };
        const lumMod = pct('a:lumMod');
        if (lumMod !== null)
            rgb = rgb.map((c) => c * lumMod);
        const lumOff = pct('a:lumOff');
        if (lumOff !== null)
            rgb = rgb.map((c) => c + 255 * lumOff);
    }
    return rgb;
}
/**
 * a:gradFill approximated as a solid color (display only): equal-weight sRGB
 * average of all stops — the first stop alone is often white and loses the
 * visible tint entirely.
 */
function gradFillApproxHex(spPr, theme) {
    const gsLst = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(spPr, 'a:gradFill') ?? {}, 'a:gsLst');
    if (!gsLst)
        return undefined;
    const stops = (0, xml_utils_1.childrenOf)(gsLst)
        .filter((n) => (0, xml_utils_1.nameOf)(n) === 'a:gs')
        .map((gs) => gradStopRgb(gs, theme))
        .filter((rgb) => rgb !== null);
    if (stops.length === 0)
        return undefined;
    return [0, 1, 2]
        .map((i) => stops.reduce((sum, rgb) => sum + rgb[i], 0) / stops.length)
        .map((c) => Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase())
        .join('');
}
function extractTextboxes(xml, ctx) {
    // wrapSquare gate keeps converter-emitted decorative rules on the thin-rule path
    const hasLineShapes = xml.includes('<wp:wrapSquare') && LINE_PRSTS_RE.test(xml);
    if (!xml.includes('<w:txbxContent') && !hasLineShapes)
        return [];
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(xml);
    }
    catch {
        return [];
    }
    const shapes = [];
    collectNodes(parsed, 'wps:wsp', shapes);
    for (const vmlName of ['v:shape', 'v:rect', 'v:roundrect']) {
        collectNodes(parsed, vmlName, shapes);
    }
    const out = [];
    for (const shape of shapes) {
        const contents = [];
        collectNodes((0, xml_utils_1.childrenOf)(shape), 'w:txbxContent', contents);
        if (contents.length === 0) {
            if (hasLineShapes) {
                const lineBox = lineBoxOf(shape);
                if (lineBox)
                    out.push(lineBox);
            }
            continue;
        }
        const box = { paras: [] };
        const shapeAttrs = (0, xml_utils_1.attrsOf)(shape);
        if ((0, xml_utils_1.nameOf)(shape) !== 'wps:wsp') {
            // VML shape: geometry from the style attribute, colors from fillcolor/strokecolor
            const style = shapeAttrs['style'] ?? '';
            const w = vmlStyleDimPx(style, 'width');
            if (w)
                box.widthPx = w;
            const h = vmlStyleDimPx(style, 'height');
            if (h) {
                box.heightPx = h;
                box.minHeightPx = h;
            }
            const fill = vmlColorHex(shapeAttrs['fillcolor']);
            if (fill && shapeAttrs['filled'] !== 'f')
                box.fill = fill;
            const stroke = vmlColorHex(shapeAttrs['strokecolor']);
            if (stroke && shapeAttrs['stroked'] !== 'f')
                box.borderColor = stroke;
            for (const content of contents)
                box.paras.push(...txbxContentParas(content, ctx));
            if (contents.some(txbxHasStructuredContent))
                box.readOnly = true;
            if (box.paras.some((p) => p.runs.length > 0))
                out.push(box);
            continue;
        }
        const spPr = (0, xml_utils_1.findChild)(shape, 'wps:spPr');
        if (spPr) {
            const fill = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(spPr, 'a:solidFill') ?? {}, 'a:srgbClr') ?? {})['val'];
            if (fill)
                box.fill = fill;
            else {
                const grad = gradFillApproxHex(spPr, ctx.themeColors);
                if (grad)
                    box.fill = grad;
            }
            const ln = (0, xml_utils_1.findChild)(spPr, 'a:ln');
            const border = ln
                ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(ln, 'a:solidFill') ?? {}, 'a:srgbClr') ?? {})['val']
                : undefined;
            if (border)
                box.borderColor = border;
            const prstGeom = (0, xml_utils_1.findChild)(spPr, 'a:prstGeom');
            const prst = prstGeom ? (0, xml_utils_1.attrsOf)(prstGeom)['prst'] : undefined;
            if (prst && prst !== 'rect')
                box.prst = prst;
            const ext = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(spPr, 'a:xfrm') ?? {}, 'a:ext');
            const cx = ext ? parseInt((0, xml_utils_1.attrsOf)(ext)['cx'] ?? '', 10) : NaN;
            if (Number.isFinite(cx) && cx > 0)
                box.widthPx = Math.round(cx / EMU_PER_PX);
            // Word clips overflowing text unless the shape auto-fits its content;
            // carrying the fixed height keeps tall sparse boxes from exploding layout
            const bodyPr = (0, xml_utils_1.findChild)(shape, 'wps:bodyPr');
            const autoFit = bodyPr ? !!(0, xml_utils_1.findChild)(bodyPr, 'a:spAutoFit') : false;
            const cy = ext ? parseInt((0, xml_utils_1.attrsOf)(ext)['cy'] ?? '', 10) : NaN;
            if (!autoFit && Number.isFinite(cy) && cy > 0) {
                box.heightPx = Math.round(cy / EMU_PER_PX);
                box.minHeightPx = box.heightPx;
            }
        }
        const bodyPr = (0, xml_utils_1.findChild)(shape, 'wps:bodyPr');
        if (bodyPr) {
            const attrs = (0, xml_utils_1.attrsOf)(bodyPr);
            const inset = (name) => {
                const emu = parseInt(attrs[name] ?? '', 10);
                return Number.isFinite(emu) && emu >= 0
                    ? Math.round((emu / EMU_PER_PX) * 100) / 100
                    : undefined;
            };
            box.insetLeftPx = inset('lIns');
            box.insetTopPx = inset('tIns');
            box.insetRightPx = inset('rIns');
            box.insetBottomPx = inset('bIns');
        }
        for (const content of contents)
            box.paras.push(...txbxContentParas(content, ctx));
        if (contents.some(txbxHasStructuredContent))
            box.readOnly = true;
        if (box.paras.some((p) => p.runs.length > 0))
            out.push(box);
    }
    return out;
}
function collectNodes(nodes, name, out) {
    for (const node of nodes) {
        if ((0, xml_utils_1.nameOf)(node) === name)
            out.push(node);
        collectNodes((0, xml_utils_1.childrenOf)(node), name, out);
    }
}
const JC_ALIGN = {
    left: 'left',
    start: 'left',
    center: 'center',
    right: 'right',
    end: 'right',
    both: 'justify',
    distribute: 'distribute',
};
/** w:autoSpaceDE/DN (Word default on): false only when both are explicitly off */
function autoSpaceOf(pPr) {
    const de = onOffOf(pPr, 'w:autoSpaceDE');
    const dn = onOffOf(pPr, 'w:autoSpaceDN');
    if (de === false && dn === false)
        return false;
    if (de === true || dn === true)
        return true;
    return undefined;
}
function extractParaFormat(pPr) {
    const format = {};
    if ((0, xml_utils_1.boolProp)(pPr, 'w:bidi'))
        format.bidi = true;
    const jc = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:jc') ?? {})['w:val'];
    if (jc && JC_ALIGN[jc])
        format.align = JC_ALIGN[jc];
    // Word quirk: in bidi paragraphs w:jc left/right are logical values (start/end); convert to visual direction
    if (format.bidi && (format.align === 'left' || format.align === 'right')) {
        format.align = format.align === 'left' ? 'right' : 'left';
    }
    const spacing = (0, xml_utils_1.findChild)(pPr, 'w:spacing');
    if (spacing) {
        const attrs = (0, xml_utils_1.attrsOf)(spacing);
        const rule = (attrs['w:lineRule'] ?? 'auto');
        const line = parseInt(attrs['w:line'] ?? '', 10);
        if (line > 0) {
            format.lineRawTwips = line;
            if (rule === 'auto') {
                format.lineSpacing = Math.round((line / 240) * 100) / 100;
                format.lineRule = 'auto';
            }
            else {
                format.lineRule = rule;
                // lineSpacing in 'auto' sense is not applicable for atLeast/exact, keep undefined
            }
        }
        // autospacing=1 means Word ignores the literal before/after and computes its own;
        // dropping the literal (→ style/docDefaults cascade) is closer than honoring it.
        // Explicit "0" must be kept — it overrides the style's spacing.
        const autoBefore = attrs['w:beforeAutospacing'] === '1' || attrs['w:beforeAutospacing'] === 'true';
        const autoAfter = attrs['w:afterAutospacing'] === '1' || attrs['w:afterAutospacing'] === 'true';
        const before = parseInt(attrs['w:before'] ?? '', 10);
        if (before >= 0 && attrs['w:before'] !== undefined && !autoBefore)
            format.spaceBefore = before;
        const after = parseInt(attrs['w:after'] ?? '', 10);
        if (after >= 0 && attrs['w:after'] !== undefined && !autoAfter)
            format.spaceAfter = after;
    }
    const ind = (0, xml_utils_1.findChild)(pPr, 'w:ind');
    if (ind) {
        const attrs = (0, xml_utils_1.attrsOf)(ind);
        const left = parseInt(attrs['w:left'] ?? attrs['w:start'] ?? '', 10);
        // Negative indent (hanging past the left margin) is legal, keep it; 0 stays out of the model
        if (Number.isFinite(left) && left !== 0)
            format.indentLeft = left;
        const right = parseInt(attrs['w:right'] ?? attrs['w:end'] ?? '', 10);
        if (Number.isFinite(right) && right !== 0)
            format.indentRight = right;
        const firstLine = parseInt(attrs['w:firstLine'] ?? '', 10);
        const hanging = parseInt(attrs['w:hanging'] ?? '', 10);
        if (hanging > 0)
            format.indentFirstLine = -hanging;
        else if (firstLine > 0)
            format.indentFirstLine = firstLine;
    }
    if ((0, xml_utils_1.boolProp)(pPr, 'w:pageBreakBefore'))
        format.pageBreakBefore = true;
    if ((0, xml_utils_1.boolProp)(pPr, 'w:keepNext'))
        format.keepNext = true;
    if ((0, xml_utils_1.boolProp)(pPr, 'w:keepLines'))
        format.keepLines = true;
    // widowControl: Word default is ON; only store when explicitly set to OFF
    const wcEl = (0, xml_utils_1.findChild)(pPr, 'w:widowControl');
    if (wcEl) {
        const wcVal = (0, xml_utils_1.attrsOf)(wcEl)['w:val'];
        // w:widowControl/ (no val) = on; w:widowControl w:val="0" or "false" = off
        if (wcVal === '0' || wcVal === 'false')
            format.widowControl = false;
    }
    if ((0, xml_utils_1.boolProp)(pPr, 'w:contextualSpacing'))
        format.contextualSpacing = true;
    const autoSpace = autoSpaceOf(pPr);
    if (autoSpace !== undefined)
        format.autoSpace = autoSpace;
    const shd = (0, xml_utils_1.findChild)(pPr, 'w:shd');
    if (shd) {
        const fill = (0, xml_utils_1.attrsOf)(shd)['w:fill'];
        if (fill && fill !== 'auto')
            format.shadingFill = fill;
    }
    const pBdr = (0, xml_utils_1.findChild)(pPr, 'w:pBdr');
    if (pBdr) {
        let borders = '';
        for (const [side, ch] of [
            ['top', 't'],
            ['bottom', 'b'],
            ['left', 'l'],
            ['right', 'r'],
        ]) {
            const el = (0, xml_utils_1.findChild)(pBdr, `w:${side}`);
            // ST_Border spells "no border" both ways, and Word writes nil whenever a style-level
            // border is reset, so treating it as present stamps a rule the document never had
            const val = el ? (0, xml_utils_1.attrsOf)(el)['w:val'] : undefined;
            if (el && val !== 'none' && val !== 'nil')
                borders += ch;
        }
        if (borders)
            format.borders = borders;
    }
    const tabsEl = (0, xml_utils_1.findChild)(pPr, 'w:tabs');
    if (tabsEl) {
        const stops = [];
        for (const tab of (0, xml_utils_1.findChildren)(tabsEl, 'w:tab')) {
            const attrs = (0, xml_utils_1.attrsOf)(tab);
            const pos = parseInt(attrs['w:pos'] ?? '', 10);
            const val = attrs['w:val'] ?? 'left';
            if (!Number.isFinite(pos))
                continue;
            const validVals = ['left', 'center', 'right', 'decimal', 'bar', 'clear'];
            const safeVal = validVals.includes(val)
                ? val
                : 'left';
            const stop = { pos, val: safeVal };
            const leader = attrs['w:leader'];
            if (leader && leader !== 'none') {
                const validLeaders = ['dot', 'hyphen', 'underscore', 'heavy', 'middleDot'];
                if (validLeaders.includes(leader)) {
                    stop.leader = leader;
                }
            }
            stops.push(stop);
        }
        if (stops.length > 0)
            format.tabStops = stops;
    }
    // Drop cap: w:framePr w:dropCap="drop"|"margin"
    const framePr = (0, xml_utils_1.findChild)(pPr, 'w:framePr');
    if (framePr) {
        const dropCapVal = (0, xml_utils_1.attrsOf)(framePr)['w:dropCap'];
        if (dropCapVal === 'drop' || dropCapVal === 'margin') {
            const lines = parseInt((0, xml_utils_1.attrsOf)(framePr)['w:lines'] ?? '3', 10) || 3;
            format.dropCap = { type: dropCapVal, lines };
        }
    }
    return Object.keys(format).length > 0 ? format : undefined;
}
/**
 * True when every field in the paragraph is an XE (index entry) marker.
 * Multi-fragment instructions or fldSimple fields fail the check, so anything
 * unusual falls back to the protected-passthrough path.
 */
/** paragraphs whose only fields are XE / REF stay editable (extractRuns round-trips them) */
/** Simple instructions foldable into an editable inline-field run (the cached result is the display text) */
const SIMPLE_INLINE_FIELD_RE = /^\s*(DATE|TIME|CREATEDATE|SAVEDATE|NUMPAGES|FILENAME|AUTHOR|PAGE)\b/;
/** HYPERLINK "url" (optional \o "tip"): the only field form folded into an editable link run;
 * any other switch (\l bookmark, \t frame...) keeps the protected-passthrough path */
function convertibleHyperlink(instr) {
    const m = /^\s*HYPERLINK\s+"([^"\\]+)"\s*(?:\\o\s+"([^"]*)"\s*)?$/.exec(decodeEntities(instr));
    if (!m)
        return null;
    return { href: m[1], ...(m[2] ? { tooltip: m[2] } : {}) };
}
function onlyXeFields(xml) {
    if (xml.includes('<w:fldSimple'))
        return false;
    const instrs = xml.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? [];
    if (instrs.length === 0)
        return false;
    return instrs.every((fragment) => {
        const text = decodeEntities(fragment.replace(/<[^>]+>/g, ''));
        return (/^\s*XE[\s"]/.test(text) ||
            /^\s*REF\s/.test(text) ||
            SIMPLE_INLINE_FIELD_RE.test(text) ||
            convertibleHyperlink(text) !== null);
    });
}
function extractRuns(pNode, ctx, mathFragments = [], rubyFragments = [], withImages = false) {
    const runs = [];
    let mathIndex = 0;
    let rubyIndex = 0;
    // Comments are only tracked when the whole range lives inside this paragraph:
    // a regenerated paragraph can then re-emit its own markers, while ranges that
    // span paragraphs are left untouched (their runs get no commentIds).
    const starts = new Set();
    const ends = new Set();
    const collectRangeIds = (nodes) => {
        for (const node of nodes) {
            const name = (0, xml_utils_1.nameOf)(node);
            if (name === 'w:commentRangeStart' || name === 'w:commentRangeEnd') {
                const id = (0, xml_utils_1.attrsOf)(node)['w:id'];
                if (id)
                    (name === 'w:commentRangeStart' ? starts : ends).add(id);
            }
            collectRangeIds((0, xml_utils_1.childrenOf)(node));
        }
    };
    collectRangeIds((0, xml_utils_1.childrenOf)(pNode));
    const complete = new Set([...starts].filter((id) => ends.has(id)));
    const activeComments = new Set();
    // inline field state: XE folds into Run.xeTerm, REF (cross-reference) into Run.refField
    let fieldDepth = 0;
    let fieldInstr = '';
    let fieldSeparated = false;
    let fieldCached = '';
    let fieldCachedRuns = [];
    const pushRun = (run, rev) => {
        if (activeComments.size > 0)
            run.commentIds = [...activeComments].sort();
        if (rev?.ins)
            run.ins = rev.ins;
        if (rev?.del)
            run.del = rev.del;
        runs.push(run);
    };
    const handleRun = (node, link, rev) => {
        const fldChar = (0, xml_utils_1.findChild)(node, 'w:fldChar');
        if (fldChar) {
            const type = (0, xml_utils_1.attrsOf)(fldChar)['w:fldCharType'];
            if (type === 'begin') {
                fieldDepth++;
                if (fieldDepth === 1) {
                    fieldInstr = '';
                    fieldSeparated = false;
                    fieldCached = '';
                    fieldCachedRuns = [];
                }
            }
            else if (type === 'separate') {
                if (fieldDepth === 1)
                    fieldSeparated = true;
            }
            else if (type === 'end') {
                fieldDepth = Math.max(0, fieldDepth - 1);
                if (fieldDepth === 0) {
                    const xe = /^\s*XE\s+(?:"([^"]*)"|(\S+))/.exec(fieldInstr);
                    const ref = /^\s*REF\s+(?:"([^"]+)"|([^\s\\]+))/.exec(fieldInstr);
                    const hyper = convertibleHyperlink(fieldInstr);
                    if (xe)
                        pushRun({ text: '', xeTerm: xe[1] ?? xe[2] }, rev);
                    else if (ref) {
                        const name = ref[1] ?? ref[2];
                        pushRun({ text: fieldCached || name, refField: name, refInstr: fieldInstr }, rev);
                    }
                    else if (hyper) {
                        // fold the field into plain link runs (the cached result keeps its
                        // formatting); regeneration emits w:hyperlink + a fresh rel
                        const linkVal = {
                            href: hyper.href,
                            ...(hyper.tooltip ? { tooltip: hyper.tooltip } : {}),
                        };
                        if (fieldCachedRuns.length > 0) {
                            for (const cached of fieldCachedRuns)
                                pushRun({ ...cached, link: linkVal }, rev);
                        }
                        else
                            pushRun({ text: hyper.href, link: linkVal }, rev);
                    }
                    else if (SIMPLE_INLINE_FIELD_RE.test(fieldInstr)) {
                        pushRun({ text: fieldCached || ' ', instrField: fieldInstr.trim() }, rev);
                    }
                    fieldInstr = '';
                    fieldSeparated = false;
                    fieldCached = '';
                    fieldCachedRuns = [];
                }
            }
            return;
        }
        if (fieldDepth > 0) {
            // keep the fragment index aligned even for ruby inside a field cache
            if ((0, xml_utils_1.findChild)(node, 'w:ruby'))
                rubyIndex++;
            const instr = (0, xml_utils_1.findChild)(node, 'w:instrText');
            if (instr)
                fieldInstr += (0, xml_utils_1.textOf)(instr);
            else if (fieldSeparated && fieldDepth === 1) {
                // REF/HYPERLINK cached result is the display text; other fields' caches are dropped
                const cached = buildRun(node, link, ctx.themeColors, ctx.themeFonts);
                if (cached) {
                    fieldCached += cached.text;
                    fieldCachedRuns.push(cached);
                }
            }
            return;
        }
        const rubyNode = (0, xml_utils_1.findChild)(node, 'w:ruby');
        if (rubyNode) {
            const xml = rubyFragments[rubyIndex++];
            const base = rubyPartText(rubyNode, 'w:rubyBase');
            const rt = rubyPartText(rubyNode, 'w:rt');
            // no fragment (textbox paths): degrade to the base characters
            if (base)
                pushRun(xml ? { text: base, ruby: { rt, xml } } : { text: base }, rev);
            return;
        }
        const noteRefNode = (0, xml_utils_1.findChild)(node, 'w:footnoteReference') ?? (0, xml_utils_1.findChild)(node, 'w:endnoteReference');
        if (noteRefNode) {
            const kind = (0, xml_utils_1.nameOf)(noteRefNode) === 'w:footnoteReference' ? 'footnote' : 'endnote';
            const id = (0, xml_utils_1.attrsOf)(noteRefNode)['w:id'];
            if (id) {
                const num = ctx.noteNumbers.get(`${kind}:${id}`);
                pushRun({ text: String(num ?? '*'), noteRef: { kind, id } }, rev);
                return;
            }
        }
        const run = buildRun(node, link, ctx.themeColors, ctx.themeFonts, withImages ? ctx.mediaByRid : undefined);
        if (run)
            pushRun(run, rev);
    };
    const walk = (nodes, link, rev) => {
        for (const node of nodes) {
            const name = (0, xml_utils_1.nameOf)(node);
            if (name === 'w:commentRangeStart' || name === 'w:commentRangeEnd') {
                const id = (0, xml_utils_1.attrsOf)(node)['w:id'];
                if (id && complete.has(id)) {
                    if (name === 'w:commentRangeStart')
                        activeComments.add(id);
                    else
                        activeComments.delete(id);
                }
            }
            else if (name === 'w:ins' || name === 'w:del') {
                const attrs = (0, xml_utils_1.attrsOf)(node);
                const info = { author: attrs['w:author'] ?? '' };
                if (attrs['w:date'])
                    info.date = attrs['w:date'];
                if (attrs['w:id'])
                    info.id = attrs['w:id'];
                const next = name === 'w:ins' ? { ...rev, ins: info } : { ...rev, del: info };
                walk((0, xml_utils_1.childrenOf)(node), link, next);
            }
            else if (name === 'w:moveFrom' || name === 'w:moveTo') {
                // Treat moveFrom like del (content was moved away) and moveTo like ins (content arrived here).
                // This allows the existing accept/reject mechanism to handle moves via del/ins marks.
                const attrs = (0, xml_utils_1.attrsOf)(node);
                const info = { author: attrs['w:author'] ?? '' };
                if (attrs['w:date'])
                    info.date = attrs['w:date'];
                if (attrs['w:id'])
                    info.id = attrs['w:id'];
                const next = name === 'w:moveFrom' ? { ...rev, del: info } : { ...rev, ins: info };
                walk((0, xml_utils_1.childrenOf)(node), link, next);
            }
            else if (name === 'w:r') {
                handleRun(node, link, rev);
            }
            else if (name === 'm:oMath') {
                // atomic inline formula; the raw fragment saves verbatim on regeneration
                const omml = mathFragments[mathIndex++];
                if (omml)
                    pushRun({ text: mathTokens(omml).join(''), math: { omml } }, rev);
            }
            else if (name === 'w:hyperlink') {
                const attrs = (0, xml_utils_1.attrsOf)(node);
                const rId = attrs['r:id'];
                const anchor = attrs['w:anchor'];
                const tooltip = attrs['w:tooltip'];
                const href = rId ? (ctx.rels.get(rId)?.target ?? '') : anchor ? `#${anchor}` : '';
                walk((0, xml_utils_1.childrenOf)(node), { href, rId, ...(tooltip ? { tooltip } : {}) }, rev);
            }
            else if (name === 'w:smartTag' || name === 'w:sdt' || name === 'w:sdtContent') {
                walk((0, xml_utils_1.childrenOf)(node), link, rev);
            }
        }
    };
    walk((0, xml_utils_1.childrenOf)(pNode));
    return mergeRuns(runs);
}
/** exact <w:ruby> fragments in document order (w:ruby has no attributes and cannot nest) */
function rubyFragmentsOf(xml) {
    return xml.match(/<w:ruby>[\s\S]*?<\/w:ruby>/g) ?? [];
}
/** concatenated w:t text of the runs inside a ruby part (w:rubyBase / w:rt) */
function rubyPartText(rubyNode, part) {
    const partNode = (0, xml_utils_1.findChild)(rubyNode, part);
    if (!partNode)
        return '';
    let text = '';
    for (const r of (0, xml_utils_1.childrenOf)(partNode)) {
        if ((0, xml_utils_1.nameOf)(r) !== 'w:r')
            continue;
        for (const c of (0, xml_utils_1.childrenOf)(r)) {
            if ((0, xml_utils_1.nameOf)(c) === 'w:t')
                text += decodeEntities((0, xml_utils_1.textOf)(c));
        }
    }
    return text;
}
/** OOXML on/off toggle, three-state: absent → undefined, explicit off → false */
function onOffOf(parent, name) {
    const child = (0, xml_utils_1.findChild)(parent, name);
    if (!child)
        return undefined;
    const val = (0, xml_utils_1.attrsOf)(child)['w:val'];
    if (val === undefined)
        return true;
    return !['0', 'false', 'none', 'off'].includes(val.toLowerCase());
}
/** Word's face for an East Asian theme slot whose typeface is empty (<a:ea typeface=""/>) */
const EMPTY_EA_THEME_FONT = 'DengXian';
/** empty EA slot faces by settings.xml w:themeFontLang w:eastAsia (zh-CN / missing → DengXian) */
const EMPTY_EA_SLOT_BY_LANG = {
    ja: { major: 'Yu Gothic', minor: 'Yu Mincho' },
};
function emptyEaSlotFont(fonts, eaRef) {
    const lang = fonts.eaLang?.toLowerCase().split('-')[0];
    const byLang = lang ? EMPTY_EA_SLOT_BY_LANG[lang] : undefined;
    if (!byLang)
        return EMPTY_EA_THEME_FONT;
    return eaRef === 'majorEastAsia' ? byLang.major : byLang.minor;
}
/** w:rFonts with theme references resolved: theme attrs supersede same-slot literal
 * values (ECMA-376 §17.3.2.26). Unresolvable references fall back to the literal,
 * except an empty eastAsia theme slot: Word keeps the theme's authority and renders
 * the theme language's default face, never the leftover literal name (eaSlotEmpty marks this). */
function themedRFonts(attrs, fonts) {
    const themeVal = (ref) => {
        if (!ref || !fonts)
            return undefined;
        switch (ref) {
            case 'majorAscii':
            case 'majorHAnsi':
                return fonts.major || undefined;
            case 'minorAscii':
            case 'minorHAnsi':
                return fonts.minor || undefined;
            case 'majorEastAsia':
                return fonts.majorEastAsia || undefined;
            case 'minorEastAsia':
                return fonts.eastAsia || undefined;
            case 'majorBidi':
                return fonts.majorCs || undefined;
            case 'minorBidi':
                return fonts.minorCs || undefined;
            default:
                return undefined;
        }
    };
    const eaRef = attrs['w:eastAsiaTheme'];
    const themedEa = themeVal(eaRef);
    const eaSlotEmpty = !themedEa && !!fonts && (eaRef === 'majorEastAsia' || eaRef === 'minorEastAsia');
    return {
        ascii: themeVal(attrs['w:asciiTheme']) ?? attrs['w:ascii'],
        hAnsi: themeVal(attrs['w:hAnsiTheme']) ?? attrs['w:hAnsi'],
        eastAsia: themedEa ?? (eaSlotEmpty ? emptyEaSlotFont(fonts, eaRef) : attrs['w:eastAsia']),
        cs: themeVal(attrs['w:cstheme']) ?? attrs['w:cs'],
        ...(eaSlotEmpty ? { eaSlotEmpty } : {}),
    };
}
function buildRun(rNode, link, theme, themeFonts, mediaByRid) {
    let text = '';
    for (const child of (0, xml_utils_1.childrenOf)(rNode)) {
        const name = (0, xml_utils_1.nameOf)(child);
        if (name === 'w:t' || name === 'w:delText')
            text += decodeEntities((0, xml_utils_1.textOf)(child));
        else if (name === 'w:tab')
            text += '\t';
        // In-paragraph page breaks (w:br w:type="page") are encoded as \f and preserved; column/soft breaks become \n
        else if (name === 'w:br')
            text += (0, xml_utils_1.attrsOf)(child)['w:type'] === 'page' ? '\f' : '\n';
        else if (name === 'w:cr')
            text += '\n';
        else if (name === 'w:noBreakHyphen')
            text += '\u2011';
        else if (name === 'w:sym') {
            const a = (0, xml_utils_1.attrsOf)(child);
            const code = parseInt(a['w:char'] ?? '', 16);
            if (Number.isFinite(code))
                text +=
                    (0, symbol_fonts_1.decodeSymbolChar)(a['w:font'] ?? '', code) ?? String.fromCodePoint((code & 0xff) + 0xf000);
        }
    }
    let image;
    if (mediaByRid) {
        const drawing = (0, xml_utils_1.findChild)(rNode, 'w:drawing');
        if (drawing) {
            const drawingXml = (0, xml_utils_1.serializeXNode)(drawing);
            const rId = /<a:blip[^>]*r:(?:embed|link)="([^"]+)"/.exec(drawingXml)?.[1];
            const dataUrl = rId ? mediaByRid.get(rId) : undefined;
            if (dataUrl) {
                image = { dataUrl, xml: drawingXml };
                const extent = /<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(drawingXml);
                const cx = Number(extent?.[1]);
                const cy = Number(extent?.[2]);
                if (cx > 0)
                    image.widthPx = Math.round(cx / EMU_PER_PX);
                if (cy > 0)
                    image.heightPx = Math.round(cy / EMU_PER_PX);
            }
        }
    }
    if (text === '' && !image)
        return null;
    const rPr = (0, xml_utils_1.findChild)(rNode, 'w:rPr');
    const run = { text };
    if (image)
        run.image = image;
    if (link)
        run.link = link;
    if (rPr) {
        run.rawRPr = (0, xml_utils_1.serializeXNode)(rPr);
        const rStyle = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:rStyle') ?? {})['w:val'];
        if (rStyle && rStyle !== 'Hyperlink')
            run.styleId = rStyle;
        const bold = onOffOf(rPr, 'w:b');
        if (bold !== undefined)
            run.bold = bold;
        const italic = onOffOf(rPr, 'w:i');
        if (italic !== undefined)
            run.italic = italic;
        if ((0, xml_utils_1.underlineProp)(rPr))
            run.underline = true;
        else if ((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:u') ?? {})['w:val'] === 'none')
            run.underline = false;
        const strike = onOffOf(rPr, 'w:strike');
        if (strike !== undefined)
            run.strike = strike;
        const color = colorFrom(rPr, theme);
        if (color)
            run.color = color;
        const sz = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:sz') ?? {})['w:val'];
        if (sz)
            run.sizeHalfPoints = parseInt(sz, 10) || undefined;
        const rf = themedRFonts((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:rFonts') ?? {}), themeFonts);
        const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi;
        if (font)
            run.font = font;
        const fontAscii = rf.ascii ?? rf.hAnsi;
        if (fontAscii)
            run.fontAscii = fontAscii;
        if (rf.cs)
            run.csFont = rf.cs;
        const spc = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:spacing') ?? {})['w:val'] ?? '', 10);
        if (spc)
            run.charSpacingTwips = spc;
        const wScale = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:w') ?? {})['w:val'] ?? '', 10);
        if (wScale > 0 && wScale !== 100)
            run.charScalePct = wScale;
        const highlight = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:highlight') ?? {})['w:val'];
        if (highlight && highlight !== 'none')
            run.highlight = highlight;
        const vertAlign = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:vertAlign') ?? {})['w:val'];
        if (vertAlign === 'superscript' || vertAlign === 'subscript')
            run.vertAlign = vertAlign;
        const em = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:em') ?? {})['w:val'];
        if (em && em !== 'none')
            run.em = em;
        const rPrChange = (0, xml_utils_1.findChild)(rPr, 'w:rPrChange');
        if (rPrChange) {
            const a = (0, xml_utils_1.attrsOf)(rPrChange);
            const oldRPr = (0, xml_utils_1.findChild)(rPrChange, 'w:rPr');
            const old = {};
            if (oldRPr) {
                if ((0, xml_utils_1.boolProp)(oldRPr, 'w:b'))
                    old.bold = true;
                if ((0, xml_utils_1.boolProp)(oldRPr, 'w:i'))
                    old.italic = true;
                if ((0, xml_utils_1.underlineProp)(oldRPr))
                    old.underline = true;
                if ((0, xml_utils_1.boolProp)(oldRPr, 'w:strike'))
                    old.strike = true;
                const oc = colorFrom(oldRPr, theme);
                if (oc)
                    old.color = oc;
                const osz = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:sz') ?? {})['w:val'];
                if (osz)
                    old.sizeHalfPoints = parseInt(osz, 10) || undefined;
                const ofonts = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:rFonts') ?? {});
                const of = ofonts['w:eastAsia'] ?? ofonts['w:ascii'] ?? ofonts['w:hAnsi'];
                if (of)
                    old.font = of;
                const ofa = ofonts['w:ascii'] ?? ofonts['w:hAnsi'];
                if (ofa)
                    old.fontAscii = ofa;
                const ospc = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:spacing') ?? {})['w:val'] ?? '', 10);
                if (ospc)
                    old.charSpacingTwips = ospc;
                const owScale = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:w') ?? {})['w:val'] ?? '', 10);
                if (owScale > 0 && owScale !== 100)
                    old.charScalePct = owScale;
                const ohighlight = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:highlight') ?? {})['w:val'];
                if (ohighlight && ohighlight !== 'none')
                    old.highlight = ohighlight;
                const overtAlign = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:vertAlign') ?? {})['w:val'];
                if (overtAlign === 'superscript' || overtAlign === 'subscript')
                    old.vertAlign = overtAlign;
                const ostyle = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(oldRPr, 'w:rStyle') ?? {})['w:val'];
                if (ostyle && ostyle !== 'Hyperlink')
                    old.styleId = ostyle;
            }
            run.rPrChange = {
                author: a['w:author'] ?? '',
                ...(a['w:date'] ? { date: a['w:date'] } : {}),
                ...(a['w:id'] ? { id: a['w:id'] } : {}),
                ...(Object.keys(old).length > 0 ? { old } : {}),
            };
        }
    }
    // Symbol-encoded fonts (Symbol/Wingdings…): swap the glyph codes for their Unicode
    // equivalents and drop the font, so the text survives systems without those fonts
    if (run.font) {
        const decoded = (0, symbol_fonts_1.decodeSymbolText)(run.font, run.text);
        if (decoded !== null) {
            run.text = decoded;
            delete run.font;
            delete run.fontAscii;
            if (run.rawRPr)
                run.rawRPr = run.rawRPr.replace(/<w:rFonts[^>]*\/>/, '');
        }
    }
    return run;
}
function mergeRuns(runs) {
    const merged = [];
    for (const run of runs) {
        const prev = merged[merged.length - 1];
        if (prev && sameStyle(prev, run))
            prev.text += run.text;
        else
            merged.push({ ...run });
    }
    return merged;
}
function sameStyle(a, b) {
    // reference markers, index entries, cross-references and inline math are atomic; never merge
    if (a.noteRef || b.noteRef || a.xeTerm !== undefined || b.xeTerm !== undefined)
        return false;
    if (a.refField !== undefined || b.refField !== undefined)
        return false;
    if (a.instrField !== undefined || b.instrField !== undefined)
        return false;
    if (a.math || b.math)
        return false;
    if (a.ruby || b.ruby)
        return false;
    if (a.image || b.image)
        return false;
    return ((a.rawRPr ?? '') === (b.rawRPr ?? '') &&
        a.styleId === b.styleId &&
        !!a.bold === !!b.bold &&
        !!a.italic === !!b.italic &&
        !!a.underline === !!b.underline &&
        !!a.strike === !!b.strike &&
        a.color === b.color &&
        a.sizeHalfPoints === b.sizeHalfPoints &&
        a.font === b.font &&
        a.fontAscii === b.fontAscii &&
        a.csFont === b.csFont &&
        a.highlight === b.highlight &&
        a.vertAlign === b.vertAlign &&
        (a.link?.href ?? '') === (b.link?.href ?? '') &&
        (a.link?.rId ?? '') === (b.link?.rId ?? '') &&
        (a.commentIds ?? []).join(',') === (b.commentIds ?? []).join(',') &&
        sameRevision(a.ins, b.ins) &&
        sameRevision(a.del, b.del));
}
function sameRevision(a, b) {
    if (!a || !b)
        return !a === !b;
    return a.author === b.author && a.date === b.date && a.id === b.id;
}
function tableSummary(xml) {
    const rows = (xml.match(/<w:tr[\s>]/g) ?? []).length;
    const firstRow = /<w:tr[\s>][\s\S]*?<\/w:tr>/.exec(xml)?.[0] ?? '';
    const cols = (firstRow.match(/<w:tc[\s>]/g) ?? []).length;
    return { label: `Table ${rows}×${cols}`, previewText: plainText(xml).slice(0, 120) };
}
/**
 * Display-only table structure. Nested tables render as read-only sub-tables
 * inside their cell; the exact original bytes are what get saved, so lossiness
 * here only affects on-screen rendering.
 */
function extractTable(xml, ctx) {
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(xml);
    }
    catch {
        return undefined;
    }
    const tbl = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:tbl');
    if (!tbl)
        return undefined;
    const model = extractTableModel(tbl, ctx);
    if (!model)
        return undefined;
    const rawTrPrs = model.rows.map(() => null);
    attachRawTablePr(xml, model.rows, rawTrPrs);
    if (rawTrPrs.some((r) => r !== null))
        model.rawTrPrs = rawTrPrs;
    return model;
}
/** One w:tbl node → display model (shared by top-level tables and tables nested in cells) */
/**
 * Per-column widths reconstructed from cell w:tcW (dxa) across all rows: the first
 * un-spanned cell seen per grid slot wins. Undefined unless every column got a value —
 * partial data would skew the ratio worse than the tblGrid fallback.
 */
function tcwColumnWidths(tbl) {
    const cols = [];
    let colCount = 0;
    for (const tr of (0, xml_utils_1.childrenThroughSdt)(tbl, 'w:tr')) {
        let idx = 0;
        for (const tc of (0, xml_utils_1.childrenThroughSdt)(tr, 'w:tc')) {
            const tcPr = (0, xml_utils_1.findChild)(tc, 'w:tcPr');
            const span = Math.max(1, Number((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tcPr ?? {}, 'w:gridSpan') ?? {})['w:val']) || 1);
            // duplicated w:tcW: Word keeps the last occurrence (generators leave stale first values)
            const a = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChildren)(tcPr ?? {}, 'w:tcW').at(-1) ?? {});
            const w = !a['w:type'] || a['w:type'] === 'dxa' ? Number(a['w:w']) || 0 : 0;
            if (span === 1 && w > 0 && !(cols[idx] > 0))
                cols[idx] = w;
            idx += span;
        }
        colCount = Math.max(colCount, idx);
    }
    if (colCount === 0)
        return undefined;
    for (let i = 0; i < colCount; i++)
        if (!(cols[i] > 0))
            return undefined;
    return cols.slice(0, colCount);
}
function extractTableModel(tbl, ctx) {
    const grid = (0, xml_utils_1.findChild)(tbl, 'w:tblGrid');
    let colWidthsPct;
    let colWidthsTwips;
    if (grid) {
        const widths = (0, xml_utils_1.findChildren)(grid, 'w:gridCol').map((c) => Number((0, xml_utils_1.attrsOf)(c)['w:w']) || 0);
        const total = widths.reduce((a, b) => a + b, 0);
        if (total > 0) {
            colWidthsPct = widths.map((w) => (w / total) * 100);
            if (widths.every((w) => w > 0))
                colWidthsTwips = widths;
        }
    }
    // Cell-level w:tcW is Word's actual layout input for auto tables; generators often
    // leave a stale evenly-split tblGrid behind. When the two disagree, tcW wins.
    const tcwWidths = tcwColumnWidths(tbl);
    if (tcwWidths) {
        const tcwTotal = tcwWidths.reduce((a, b) => a + b, 0);
        const tcwPct = tcwWidths.map((w) => (w / tcwTotal) * 100);
        const disagree = !colWidthsPct ||
            colWidthsPct.length !== tcwPct.length ||
            colWidthsPct.some((w, i) => Math.abs(w - tcwPct[i]) > 2);
        if (disagree) {
            colWidthsPct = tcwPct;
            colWidthsTwips = tcwWidths;
        }
    }
    const tblPrNode = (0, xml_utils_1.findChild)(tbl, 'w:tblPr');
    const tblW = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:tblW') ?? {});
    let widthPct;
    if (tblW['w:type'] === 'pct') {
        const raw = String(tblW['w:w'] ?? '');
        // The pct unit is 1/50 of a percentage point; some generators write a literal "NN%"
        const pct = raw.endsWith('%') ? parseFloat(raw) : Number(raw) / 50;
        if (Number.isFinite(pct) && pct > 0 && pct <= 100)
            widthPct = pct;
    }
    const cellMar = cellMarginsOf((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:tblCellMar'));
    const tblBorders = borderLinesOf((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:tblBorders'), true);
    const tblJc = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:jc') ?? {})['w:val'];
    const tblAlign = tblJc === 'center' ? 'center' : tblJc === 'right' || tblJc === 'end' ? 'right' : undefined;
    const tblInd = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:tblInd') ?? {});
    const tblIndTwips = !tblInd['w:type'] || tblInd['w:type'] === 'dxa' ? Number(tblInd['w:w']) : NaN;
    const rows = [];
    const rowHeightsTwips = [];
    const rowHeightRules = [];
    const rowRevisions = [];
    for (const tr of (0, xml_utils_1.childrenThroughSdt)(tbl, 'w:tr')) {
        const cells = [];
        for (const tc of (0, xml_utils_1.childrenThroughSdt)(tr, 'w:tc')) {
            const cell = extractCell(tc, ctx);
            const prev = cells[cells.length - 1];
            // Legacy horizontal merge: continue cells fold into the cell to their left (same effect
            // as gridSpan)
            if (cell.hMerge === 'continue' && prev) {
                prev.colSpan = (prev.colSpan ?? 1) + (cell.colSpan ?? 1);
                continue;
            }
            cells.push(cell);
        }
        if (cells.length > 0) {
            rows.push(cells);
            const trPr = (0, xml_utils_1.findChild)(tr, 'w:trPr');
            const trH = trPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(trPr, 'w:trHeight') ?? {}) : {};
            const h = Number(trH['w:val']);
            const hasH = Number.isFinite(h) && h > 0;
            // Word clamps trHeight to 31680 twips / 22in (MS-OI29500 2.1.51); some generators leak EMU-scale values here
            rowHeightsTwips.push(hasH ? Math.min(h, 31680) : null);
            rowHeightRules.push(hasH ? (trH['w:hRule'] === 'exact' ? 'exact' : 'atLeast') : null);
            rowRevisions.push(trPr ? rowRevisionOf(trPr) : null);
        }
    }
    if (rows.length === 0)
        return undefined;
    applyTableStyleDisplay(rows, (0, xml_utils_1.findChild)(tbl, 'w:tblPr'), ctx);
    // Borders/margins from the table style (styles.xml, basedOn chain included): fallback
    // when the document level declares none
    const styleIdEarly = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPrNode ?? {}, 'w:tblStyle') ?? {})['w:val'];
    const styleTable = styleIdEarly ? ctx.styles.get(styleIdEarly)?.tableDisplay : undefined;
    const effBorders = tblBorders ?? styleTable?.borders;
    const effCellMar = cellMar ?? styleTable?.cellMarTwips;
    const model = { rows, colWidthsPct };
    if (colWidthsTwips)
        model.colWidthsTwips = colWidthsTwips;
    if (widthPct)
        model.widthPct = widthPct;
    if (effCellMar)
        model.cellMarTwips = effCellMar;
    if (effBorders)
        model.borders = effBorders;
    if (tblAlign)
        model.align = tblAlign;
    if (Number.isFinite(tblIndTwips) && tblIndTwips !== 0)
        model.indentTwips = tblIndTwips;
    const tblStyle = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(tbl, 'w:tblPr') ?? {}, 'w:tblStyle') ?? {})['w:val'];
    if (tblStyle)
        model.tblStyleId = tblStyle;
    if (tblPrNode && (0, xml_utils_1.boolProp)(tblPrNode, 'w:bidiVisual'))
        model.bidiVisual = true;
    if (rowHeightsTwips.some((h) => h !== null)) {
        model.rowHeightsTwips = rowHeightsTwips;
        model.rowHeightRules = rowHeightRules;
    }
    if (rowRevisions.some((r) => r !== null))
        model.rowRevisions = rowRevisions;
    return model;
}
/** trPr w:ins / w:del → row-level revision (inserted/deleted row) */
function rowRevisionOf(trPr) {
    for (const kind of ['ins', 'del']) {
        const node = (0, xml_utils_1.findChild)(trPr, `w:${kind}`);
        if (!node)
            continue;
        const a = (0, xml_utils_1.attrsOf)(node);
        return {
            kind,
            author: a['w:author'] ?? '',
            ...(a['w:date'] ? { date: a['w:date'] } : {}),
            ...(a['w:id'] ? { id: a['w:id'] } : {}),
        };
    }
    return null;
}
/**
 * Attach each cell's rawTcPr and each row's rawTrPr from the original table XML (byte
 * fidelity: surgically patched on regeneration so unmodeled tcMar/textDirection/
 * tblHeader etc. are not lost). Uses depth-aware splitXmlChildren so nested tables do
 * not misalign; gives up when row/column counts disagree with the parse result
 * (conservative — never attach to the wrong cell).
 */
function attachRawTablePr(xml, rows, rawTrPrs) {
    const open = /<w:tbl[\s>]/.exec(xml);
    if (!open)
        return;
    const innerStart = xml.indexOf('>', open.index) + 1;
    const innerEnd = xml.lastIndexOf('</w:tbl>');
    if (innerStart <= 0 || innerEnd < 0)
        return;
    const trs = (0, generate_1.splitXmlChildren)(xml.slice(innerStart, innerEnd)).filter((c) => c.name === 'w:tr');
    if (trs.length !== rows.length)
        return;
    trs.forEach((tr, ri) => {
        const trOpenEnd = tr.xml.indexOf('>') + 1;
        const trInner = tr.xml.slice(trOpenEnd, tr.xml.lastIndexOf('</w:tr>'));
        const kids = (0, generate_1.splitXmlChildren)(trInner);
        const trPr = kids.find((k) => k.name === 'w:trPr');
        if (trPr)
            rawTrPrs[ri] = trPr.xml;
        const tcs = kids.filter((k) => k.name === 'w:tc');
        if (tcs.length !== rows[ri].length)
            return;
        tcs.forEach((tc, ci) => {
            const tcOpenEnd = tc.xml.indexOf('>') + 1;
            const tcInner = tc.xml.slice(tcOpenEnd, tc.xml.lastIndexOf('</w:tc>'));
            const tcPr = (0, generate_1.splitXmlChildren)(tcInner).find((k) => k.name === 'w:tcPr');
            if (tcPr)
                rows[ri][ci].rawTcPr = tcPr.xml;
        });
    });
}
/**
 * Layer the referenced table style's fills / first-row formatting under the
 * cells' explicit properties, honoring the w:tblLook flags. Display-only:
 * untouched tables still save byte-identically.
 */
function applyTableStyleDisplay(rows, tblPr, ctx) {
    if (!tblPr)
        return;
    const styleId = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPr, 'w:tblStyle') ?? {})['w:val'];
    const ts = styleId ? ctx.styles.get(styleId)?.tableDisplay : undefined;
    if (!ts)
        return;
    const look = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tblPr, 'w:tblLook') ?? {});
    const bits = parseInt(look['w:val'] ?? '', 16);
    const flag = (attr, bit, dflt) => look[attr] !== undefined
        ? look[attr] !== '0' && look[attr] !== 'false'
        : Number.isFinite(bits)
            ? (bits & bit) !== 0
            : dflt;
    const firstRowOn = flag('w:firstRow', 0x20, true);
    const lastRowOn = flag('w:lastRow', 0x40, false);
    const firstColOn = flag('w:firstColumn', 0x80, true);
    const lastColOn = flag('w:lastColumn', 0x100, false);
    const hBandOn = !flag('w:noHBand', 0x200, false);
    const totalCols = Math.max(...rows.map((row) => row.reduce((sum, c) => sum + (c.colSpan ?? 1), 0)));
    rows.forEach((row, r) => {
        const isFirst = firstRowOn && r === 0;
        const isLast = lastRowOn && r === rows.length - 1;
        const bandRow = firstRowOn ? r - 1 : r;
        const bandFill = hBandOn && bandRow >= 0 ? (bandRow % 2 === 0 ? ts.band1Fill : ts.band2Fill) : undefined;
        let col = 0;
        for (const cell of row) {
            const span = cell.colSpan ?? 1;
            // Word's conditional-format precedence: rows beat columns, all beat bands/whole-table
            const conds = [
                isFirst ? ts.firstRow : undefined,
                isLast ? ts.lastRow : undefined,
                firstColOn && col === 0 ? ts.firstCol : undefined,
                lastColOn && col + span === totalCols ? ts.lastCol : undefined,
            ];
            col += span;
            if (cell.fill === undefined) {
                cell.fill = conds.find((c) => c?.fill)?.fill ?? bandFill ?? ts.fill ?? undefined;
            }
            const bold = conds.some((c) => c?.bold) || ts.wholeTable?.bold;
            if (bold && cell.bold === undefined)
                cell.bold = true;
            const color = conds.find((c) => c?.color)?.color ?? ts.wholeTable?.color;
            if (color && !cell.color)
                cell.color = color;
        }
    });
}
function borderLinesOf(node, withInside) {
    if (!node)
        return undefined;
    const ALIAS = {
        'w:top': 'top',
        'w:left': 'left',
        'w:bottom': 'bottom',
        'w:right': 'right',
        'w:start': 'left',
        'w:end': 'right',
        ...(withInside ? { 'w:insideH': 'insideH', 'w:insideV': 'insideV' } : {}),
    };
    const borders = {};
    for (const [tag, side] of Object.entries(ALIAS)) {
        const child = (0, xml_utils_1.findChild)(node, tag);
        if (!child || borders[side])
            continue;
        const a = (0, xml_utils_1.attrsOf)(child);
        if (!a['w:val'])
            continue;
        borders[side] = {
            style: a['w:val'],
            ...(a['w:sz'] ? { szEighths: Number(a['w:sz']) || undefined } : {}),
            ...(a['w:color'] ? { color: a['w:color'] } : {}),
        };
    }
    return Object.keys(borders).length > 0 ? borders : undefined;
}
function cellMarginsOf(node) {
    if (!node)
        return undefined;
    const SIDES = [
        ['w:top', 'top'],
        ['w:left', 'left'],
        ['w:bottom', 'bottom'],
        ['w:right', 'right'],
        ['w:start', 'left'],
        ['w:end', 'right'],
    ];
    const m = {};
    for (const [tag, side] of SIDES) {
        const a = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(node, tag) ?? {});
        if (a['w:type'] && a['w:type'] !== 'dxa')
            continue;
        const v = Number(a['w:w']);
        if (Number.isFinite(v) && v >= 0 && m[side] === undefined)
            m[side] = v;
    }
    return Object.keys(m).length > 0 ? m : undefined;
}
function extractCell(tc, ctx) {
    const cell = { paras: [] };
    const richParas = [];
    const tcPr = (0, xml_utils_1.findChild)(tc, 'w:tcPr');
    if (tcPr) {
        const span = Number((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tcPr, 'w:gridSpan') ?? {})['w:val']);
        if (span > 1)
            cell.colSpan = span;
        const vMerge = (0, xml_utils_1.findChild)(tcPr, 'w:vMerge');
        if (vMerge) {
            cell.vMerge = (0, xml_utils_1.attrsOf)(vMerge)['w:val'] === 'restart' ? 'restart' : 'continue';
        }
        const fill = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tcPr, 'w:shd') ?? {})['w:fill'];
        if (fill && fill !== 'auto')
            cell.fill = fill;
        const vAlign = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tcPr, 'w:vAlign') ?? {})['w:val'];
        if (vAlign === 'center' || vAlign === 'bottom' || vAlign === 'top')
            cell.vAlign = vAlign;
        const tcMar = cellMarginsOf((0, xml_utils_1.findChild)(tcPr, 'w:tcMar'));
        if (tcMar)
            cell.cellMarTwips = tcMar;
        const dir = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(tcPr, 'w:textDirection') ?? {})['w:val'];
        if (dir === 'tbRl' || dir === 'tbRlV')
            cell.textDirection = 'tbRl';
        else if (dir === 'btLr' || dir === 'btLrV')
            cell.textDirection = 'btLr';
        const hMerge = (0, xml_utils_1.findChild)(tcPr, 'w:hMerge');
        if (hMerge)
            cell.hMerge = (0, xml_utils_1.attrsOf)(hMerge)['w:val'] === 'restart' ? 'restart' : 'continue';
        const borders = borderLinesOf((0, xml_utils_1.findChild)(tcPr, 'w:tcBorders'), false);
        if (borders)
            cell.borders = borders;
        for (const kind of ['ins', 'del']) {
            const node = (0, xml_utils_1.findChild)(tcPr, kind === 'ins' ? 'w:cellIns' : 'w:cellDel');
            if (!node)
                continue;
            const a = (0, xml_utils_1.attrsOf)(node);
            cell.cellRevision = {
                kind,
                author: a['w:author'] ?? '',
                ...(a['w:date'] ? { date: a['w:date'] } : {}),
                ...(a['w:id'] ? { id: a['w:id'] } : {}),
            };
            break;
        }
    }
    // Tables nested in a cell: parsed as read-only sub-tables (byte fidelity is the
    // outer table's responsibility); anchors record their position among the paragraphs
    const nested = [];
    const nestedAnchors = [];
    let sawBold = false;
    let sawNonBold = false;
    const runColors = new Set();
    for (const block of (0, xml_utils_1.childrenThroughSdt)(tc, ['w:p', 'w:tbl'])) {
        if ((0, xml_utils_1.nameOf)(block) === 'w:tbl') {
            const model = extractTableModel(block, ctx);
            if (model) {
                nested.push(model);
                nestedAnchors.push(cell.paras.length);
            }
            continue;
        }
        const p = block;
        cell.paras.push((0, xml_utils_1.textOf)(p));
        const pPr = (0, xml_utils_1.findChild)(p, 'w:pPr');
        const format = extractParaFormat(pPr ?? {});
        const cellStyleId = pPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:pStyle') ?? {})['w:val'] : undefined;
        const cellRef = listRefOf(ctx, pPr, cellStyleId);
        const list = cellRef
            ? {
                kind: listKindOf(ctx, cellRef.numId, cellRef.ilvl),
                numId: cellRef.numId,
                ilvl: cellRef.ilvl,
            }
            : undefined;
        richParas.push({
            ...format,
            ...(list ? { list } : {}),
            runs: extractRuns(p, ctx, [], [], true),
        });
        if (!cell.align) {
            const jc = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(p, 'w:pPr') ?? {}, 'w:jc') ?? {})['w:val'];
            if (jc === 'center' || jc === 'right' || jc === 'left' || jc === 'justify') {
                cell.align = jc;
            }
        }
        for (const r of (0, xml_utils_1.findChildren)(p, 'w:r')) {
            const rPr = (0, xml_utils_1.findChild)(r, 'w:rPr');
            if (rPr && (0, xml_utils_1.boolProp)(rPr, 'w:b'))
                sawBold = true;
            else
                sawNonBold = true;
            if ((0, xml_utils_1.textOf)(r) !== '')
                runColors.add((rPr && colorFrom(rPr, ctx.themeColors)) ?? 'none');
        }
    }
    // drop trailing empty paragraphs so cells don't get artificially tall
    while (cell.paras.length > 1 && cell.paras[cell.paras.length - 1] === '') {
        cell.paras.pop();
        richParas.pop();
    }
    cell.richParas = richParas;
    if (nested.length > 0) {
        cell.nestedTables = nested;
        // clamp anchors that pointed past the trimmed tail
        cell.nestedTableAnchors = nestedAnchors.map((a) => Math.min(a, cell.paras.length));
    }
    if (sawBold && !sawNonBold)
        cell.bold = true;
    // cell.color only when every text run agrees (mixed colors stay run-level)
    if (runColors.size === 1) {
        const only = runColors.values().next().value;
        if (only !== 'none')
            cell.color = only;
    }
    return cell;
}
function hfPartInfo(part) {
    if (!part)
        return null;
    return {
        text: part.text,
        hasPageNumber: part.hasPageNumber,
        paras: part.paras,
        ...(part.images?.length ? { images: part.images } : {}),
    };
}
/**
 * display-only images of a header/footer part (logos etc.): resolves a:blip r:embed
 * and VML v:imagedata r:id from the part's own rels; watermarks (v:textpath) excluded.
 * The save path does not go through here -- image paragraphs keep their original bytes
 * when the part is regenerated.
 */
async function hfImages(zip, partPath, partXml) {
    if (!partXml.includes('<a:blip') && !partXml.includes('<v:imagedata'))
        return [];
    const relsPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels');
    const rels = await parseRels(zip, relsPath);
    const out = [];
    for (const frag of partXml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) ?? []) {
        const rId = /<a:blip[^>]*r:embed="([^"]+)"/.exec(frag)?.[1];
        if (!rId)
            continue;
        const dataUrl = await mediaDataUrl(zip, rels, rId);
        if (!dataUrl)
            continue;
        const image = { dataUrl };
        const extent = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? '';
        const cx = parseInt(/cx="(\d+)"/.exec(extent)?.[1] ?? '', 10);
        const cy = parseInt(/cy="(\d+)"/.exec(extent)?.[1] ?? '', 10);
        if (Number.isFinite(cx) && cx > 0)
            image.widthPx = Math.round(cx / EMU_PER_PX);
        if (Number.isFinite(cy) && cy > 0)
            image.heightPx = Math.round(cy / EMU_PER_PX);
        if (/<wp:anchor[\s>]/.test(frag))
            image.floating = true;
        out.push(image);
    }
    for (const frag of partXml.match(/<w:pict>[\s\S]*?<\/w:pict>/g) ?? []) {
        if (frag.includes('<v:textpath'))
            continue;
        const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(frag)?.[1];
        if (!rId)
            continue;
        const dataUrl = await mediaDataUrl(zip, rels, rId);
        if (!dataUrl)
            continue;
        // VML dimensions live in the v:shape style attribute (pt)
        const style = /<v:shape[^>]*style="([^"]*)"/.exec(frag)?.[1] ?? '';
        const w = parseFloat(/width:([\d.]+)pt/.exec(style)?.[1] ?? '');
        const h = parseFloat(/height:([\d.]+)pt/.exec(style)?.[1] ?? '');
        const image = { dataUrl };
        if (Number.isFinite(w) && w > 0)
            image.widthPx = Math.round((w / 72) * 96);
        if (Number.isFinite(h) && h > 0)
            image.heightPx = Math.round((h / 72) * 96);
        out.push(image);
    }
    return out;
}
/** settings.xml <w:evenAndOddHeaders/> (w:val="0|false" counts as off) */
async function parseEvenAndOddHeaders(zip) {
    const file = zip.file('word/settings.xml');
    if (!file)
        return false;
    const m = /<w:evenAndOddHeaders[^>]*\/>/.exec(await file.async('string'));
    return m !== null && !/w:val="(?:0|false)"/.test(m[0]);
}
/** header/footer part XML -> display content (PAGE fields shown as PAGE_MARK) */
function hfContentFromXml(xml, kind, theme) {
    // Rewrite each field span (begin..end) for display. PAGE and NUMPAGES become
    // private-use markers (the renderer substitutes real numbers; a literal '#'
    // in the part text must never be mistaken for the field), dropping their
    // stale cached results; other fields (DATE, STYLEREF, ...) keep their cached
    // result runs (Word refreshes them on open). fldChar attribute matching is
    // tolerant (Pages writes w:fldLock="0" etc.).
    // hasPageNumber is set by the same match that emits PAGE_MARK, so the two
    // can't drift (Word may split "PAGE" across several instrText runs).
    let hasPageNumber = false;
    let cleaned = xml.replace(/<w:fldChar[^>]*w:fldCharType="begin"[^>]*\/>[\s\S]*?<w:fldChar[^>]*w:fldCharType="end"[^>]*\/>/g, (span) => {
        const instr = (span.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? [])
            .map((m) => m.replace(/<[^>]+>/g, ''))
            .join('');
        const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(span)?.[0] ?? '';
        // the span starts inside the begin run and ends inside the end run, so
        // the replacement closes/reopens the enclosing w:r to stay balanced
        // (the leftover edge runs end up empty and are dropped later)
        const emit = (inner) => `</w:r>${inner}<w:r>`;
        if (/\bNUMPAGES\b/.test(instr)) {
            return emit(`<w:r>${rPr}<w:t>${types_1.TOTAL_PAGES_MARK}</w:t></w:r>`);
        }
        if (/\bPAGE\b/.test(instr)) {
            hasPageNumber = true;
            return emit(`<w:r>${rPr}<w:t>${types_1.PAGE_MARK}</w:t></w:r>`);
        }
        const cached = /<w:fldChar[^>]*w:fldCharType="separate"[^>]*\/>([\s\S]*)$/.exec(span)?.[1];
        // complete result runs between separate and end (partial run fragments at the edges drop out)
        return emit((cached?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? [])
            .filter((run) => run.includes('<w:t'))
            .join(''));
    });
    // <w:fldSimple w:instr=" PAGE "> single-element field form
    cleaned = cleaned.replace(/<w:fldSimple[^>]*w:instr="([^"]*)"[^>]*(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g, (whole, instr, inner) => {
        const rPr = inner ? (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? '') : '';
        if (/\bNUMPAGES\b/.test(instr))
            return `<w:r>${rPr}<w:t>${types_1.TOTAL_PAGES_MARK}</w:t></w:r>`;
        if (/\bPAGE\b/.test(instr)) {
            hasPageNumber = true;
            return `<w:r>${rPr}<w:t>${types_1.PAGE_MARK}</w:t></w:r>`;
        }
        return inner ?? whole;
    });
    return {
        text: plainText(cleaned),
        hasPageNumber,
        watermark: kind === 'header' ? (0, watermark_1.readWatermarkText)(xml) : null,
        // strip leftover field chars so the page marker parses as plain text
        paras: hfParagraphs(cleaned.replace(/<w:fldChar[^>]*\/>/g, ''), theme),
    };
}
/** Plain-text content of a header/footer part referenced by any sectPr. */
async function readHeaderFooterPart(zip, documentXml, rels, kind, hfType = 'default', theme) {
    const refs = documentXml.match(new RegExp(`<w:${kind}Reference[^>]*/>`, 'g')) ?? [];
    const typed = refs.find((r) => r.includes(`w:type="${hfType}"`));
    // untyped references count as default (w:type is technically required but often omitted)
    const ref = hfType === 'default' ? (typed ?? refs.find((r) => !/w:type="/.test(r))) : typed;
    if (!ref)
        return null;
    const rId = /r:id="([^"]+)"/.exec(ref)?.[1];
    const target = rId ? rels.get(rId)?.target : undefined;
    if (!target)
        return null;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    const file = zip.file(path);
    if (!file)
        return null;
    const xml = await file.async('string');
    const content = hfContentFromXml(xml, kind, theme);
    const images = await hfImages(zip, path, xml);
    return images.length > 0 ? { ...content, images } : content;
}
/** All header/footer parts by rId (multi-section docs look them up via each section's sectPr refs) */
async function parseAllHfParts(zip, rels, theme) {
    const out = {};
    for (const [rId, rel] of rels) {
        const kind = rel.type.endsWith('/header')
            ? 'header'
            : rel.type.endsWith('/footer')
                ? 'footer'
                : null;
        if (!kind)
            continue;
        const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;
        const file = zip.file(path);
        if (!file)
            continue;
        const xml = await file.async('string');
        const content = hfContentFromXml(xml, kind, theme);
        const images = await hfImages(zip, path, xml);
        out[rId] = {
            text: content.text,
            hasPageNumber: content.hasPageNumber,
            paras: content.paras,
            ...(images.length > 0 ? { images } : {}),
        };
    }
    return out;
}
/** rich paragraphs of a header/footer part (watermark/drawing paragraphs skipped) */
function hfParagraphs(partXml, theme) {
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(partXml);
    }
    catch {
        return [];
    }
    const root = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:hdr' || (0, xml_utils_1.nameOf)(n) === 'w:ftr');
    if (!root)
        return [];
    // header parts have their own rels; hyperlink targets are not resolved here
    const ctx = {
        rels: new Map(),
        noteNumbers: new Map(),
        themeColors: theme,
    };
    const out = [];
    for (const node of (0, xml_utils_1.childrenOf)(root)) {
        const name = (0, xml_utils_1.nameOf)(node);
        if (name === 'w:tbl') {
            // layout tables (logo | title | date rows): one display paragraph per row
            out.push(...hfTableRowParagraphs(node, ctx));
            continue;
        }
        if (name !== 'w:p')
            continue;
        const pNode = node;
        const runs = extractRuns(pNode, ctx);
        if (runs.length === 0 && ((0, xml_utils_1.findChild)(pNode, 'w:r') || (0, xml_utils_1.findChild)(pNode, 'w:pict'))) {
            // Government-style footers keep their text (e.g. the "— PAGE —" page number)
            // inside a VML textbox shape; surface those inner paragraphs instead of dropping
            // the content. Watermark / decorative drawing paragraphs still skip.
            out.push(...textboxParagraphs(pNode, ctx));
            continue;
        }
        const pPr = (0, xml_utils_1.findChild)(pNode, 'w:pPr');
        out.push({ ...(pPr ? extractParaFormat(pPr) : {}), runs });
    }
    // trailing all-empty paragraphs are layout noise
    while (out.length > 0 && out[out.length - 1].runs.length === 0 && !out[out.length - 1].cells) {
        out.pop();
    }
    return out;
}
/** header/footer top-level table → one paragraph per row, cells as width-proportioned columns */
function hfTableRowParagraphs(tbl, ctx) {
    const grid = (0, xml_utils_1.findChild)(tbl, 'w:tblGrid');
    const gridCols = grid
        ? (0, xml_utils_1.findChildren)(grid, 'w:gridCol').map((g) => Number((0, xml_utils_1.attrsOf)(g)['w:w']) || 0)
        : [];
    const out = [];
    for (const tr of (0, xml_utils_1.childrenThroughSdt)(tbl, 'w:tr')) {
        const tcs = (0, xml_utils_1.childrenThroughSdt)(tr, 'w:tc');
        const widths = tcs.map((tc) => {
            const a = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(tc, 'w:tcPr') ?? {}, 'w:tcW') ?? {});
            const v = Number(a['w:w']);
            return a['w:type'] !== 'pct' && Number.isFinite(v) && v > 0 ? v : 0;
        });
        if (widths.some((w) => w <= 0) && gridCols.some((w) => w > 0)) {
            let col = 0;
            tcs.forEach((tc, i) => {
                const span = Number((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(tc, 'w:tcPr') ?? {}, 'w:gridSpan') ?? {})['w:val']) ||
                    1;
                widths[i] = gridCols.slice(col, col + span).reduce((s, w) => s + w, 0);
                col += span;
            });
        }
        const total = widths.reduce((s, w) => s + w, 0);
        const cells = tcs.map((tc, i) => {
            const runs = [];
            let align;
            for (const p of (0, xml_utils_1.childrenThroughSdt)(tc, 'w:p')) {
                const pRuns = extractRuns(p, ctx);
                if (runs.length > 0 && pRuns.length > 0)
                    runs.push({ text: ' ' });
                runs.push(...pRuns);
                const pPr = (0, xml_utils_1.findChild)(p, 'w:pPr');
                if (!align && pPr)
                    align = extractParaFormat(pPr)?.align;
            }
            return {
                runs,
                ...(align ? { align } : {}),
                ...(total > 0 && widths[i] > 0 ? { widthPct: (widths[i] / total) * 100 } : {}),
            };
        });
        if (cells.some((c) => c.runs.some((r) => r.text !== '')))
            out.push({ runs: [], cells });
    }
    return out;
}
/** text paragraphs nested inside textbox shapes (VML v:textbox / DrawingML wps:txbx → w:txbxContent) */
function textboxParagraphs(pNode, ctx) {
    const out = [];
    const walk = (node) => {
        if ((0, xml_utils_1.nameOf)(node) === 'w:txbxContent') {
            for (const inner of (0, xml_utils_1.findChildren)(node, 'w:p')) {
                const runs = extractRuns(inner, ctx);
                if (runs.length === 0)
                    continue;
                const pPr = (0, xml_utils_1.findChild)(inner, 'w:pPr');
                out.push({ ...(pPr ? extractParaFormat(pPr) : {}), runs });
            }
            return;
        }
        for (const child of (0, xml_utils_1.childrenOf)(node))
            walk(child);
    };
    walk(pNode);
    return out;
}
async function parseNotesPart(zip, kind) {
    const file = zip.file(notes_1.NOTE_PART_PATH[kind]);
    if (!file)
        return [];
    return (0, notes_1.parseNotesXml)(await file.async('string'), kind);
}
async function parseSources(zip) {
    const path = await (0, sources_1.findSourcesPart)(zip);
    if (!path)
        return [];
    return (0, sources_1.parseSourcesXml)(await zip.file(path).async('string'));
}
async function parseTheme(zip) {
    const file = zip.file(theme_1.THEME_PART_PATH);
    if (!file)
        return { fonts: null, colors: null };
    const xml = await file.async('string');
    const fonts = (0, theme_1.readThemeFonts)(xml);
    if (fonts) {
        const eaLang = await readThemeFontLangEa(zip);
        if (eaLang)
            fonts.eaLang = eaLang;
    }
    return { fonts, colors: (0, theme_1.readThemeColors)(xml) };
}
/** settings.xml w:themeFontLang w:eastAsia */
async function readThemeFontLangEa(zip) {
    const file = zip.file('word/settings.xml');
    if (!file)
        return undefined;
    return /<w:themeFontLang\b[^>]*\bw:eastAsia="([^"]+)"/.exec(await file.async('string'))?.[1];
}
function plainText(xml) {
    const texts = [];
    // a space at cell boundaries keeps table text from gluing together
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:tc>/g;
    let m;
    let pendingGap = false;
    while ((m = re.exec(xml)) !== null) {
        if (m[0] === '</w:tc>') {
            pendingGap = texts.length > 0;
            continue;
        }
        if (pendingGap) {
            texts.push(' ');
            pendingGap = false;
        }
        texts.push(m[1]);
    }
    return decodeEntities(texts.join(''));
}
/** Visible OMML leaf tokens; editing these preserves the surrounding formula tree. */
function mathTokens(xml) {
    const tokens = [];
    const re = /<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null)
        tokens.push(decodeEntities(m[1]));
    return tokens;
}
function decodeEntities(text) {
    return text
        .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (entity, hex, decimal) => {
        const codePoint = parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
        return Number.isFinite(codePoint) &&
            codePoint >= 0 &&
            codePoint <= 0x10ffff &&
            !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? String.fromCodePoint(codePoint)
            : entity;
    })
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
/**
 * Display-only rendering hint for protected field paragraphs. The visible
 * field *result* (w:t runs; instruction text lives in w:instrText and is
 * excluded) is shown instead of a generic chip. Original XML still saves
 * byte-identical.
 */
function fieldDisplayOf(xml) {
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? '';
    // "TOC1" (Word) or "TOC 1" (Pages export)
    const tocLevel = /^TOC ?([1-9])$/i.exec(styleId);
    if (tocLevel) {
        // TOC entry: title <tab with dot leader> page number
        let left = '';
        let right = '';
        let seenTab = false;
        const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
            if (m[0] === '<w:tab/>')
                seenTab = true;
            else if (seenTab)
                right += m[1];
            else
                left += m[1];
        }
        const anchor = /<w:hyperlink [^>]*w:anchor="([^"]+)"/.exec(xml)?.[1];
        return {
            kind: 'tocLine',
            left: decodeEntities(left).trim(),
            right: decodeEntities(right).trim(),
            level: parseInt(tocLevel[1], 10),
            ...(anchor ? { anchor } : {}),
        };
    }
    const visible = plainText(xml).trim();
    if (visible === '' && /<w:br\s[^>]*w:type="page"/.test(xml)) {
        return { kind: 'pageBreak' };
    }
    if (visible !== '') {
        return { kind: 'text', left: visible };
    }
    return undefined;
}
/**
 * TOC entries carry their outline number ("1.", "1.1.") as w:numPr numbering
 * (Pages exports one numId per entry with startOverride restarts). The field
 * result is a display-only cache, so the marker is computed once at parse time
 * and stored on the tocLine FieldDisplay. Counters run document-wide in block
 * order, shared with editable list items (same abstractNum semantics).
 */
function applyTocEntryNumbers(blocks, numbering) {
    if (numbering.size === 0)
        return;
    const items = [];
    const tocAt = new Map();
    for (const block of blocks) {
        if (block.list?.numId) {
            items.push({ numId: block.list.numId, ilvl: block.list.ilvl });
            continue;
        }
        const fd = block.fieldDisplay;
        if (block.type !== 'passthrough' || fd?.kind !== 'tocLine' || !block.originalXml)
            continue;
        const numPr = /<w:numPr>[\s\S]*?<\/w:numPr>/.exec(block.originalXml)?.[0];
        if (!numPr)
            continue;
        const numId = /<w:numId w:val="([^"]+)"/.exec(numPr)?.[1];
        if (!numId)
            continue;
        const ilvl = parseInt(/<w:ilvl w:val="(\d+)"/.exec(numPr)?.[1] ?? '0', 10);
        tocAt.set(items.length, fd);
        items.push({ numId, ilvl });
    }
    if (tocAt.size === 0)
        return;
    const markers = (0, list_markers_1.computeListMarkers)(items, numbering);
    for (const [i, fd] of tocAt) {
        const marker = markers[i];
        // bullets make no sense in front of a TOC entry; only ordered markers show
        if (marker && !/^[•◦▪➢❖✓]$/.test(marker))
            fd.num = marker;
    }
}
const FIELD_LABELS = {
    TOC: 'Auto TOC (updates when opened in Word)',
    PAGE: 'Page number field',
    NUMPAGES: 'Page count field',
    PAGEREF: 'Page reference field',
    REF: 'Cross-reference field',
    SEQ: 'Caption number field',
    HYPERLINK: 'Hyperlink field',
    DATE: 'Date field',
    TIME: 'Time field',
    INCLUDEPICTURE: 'Linked picture field',
    STYLEREF: 'Style reference field',
};
/** Human-readable label for a protected field paragraph, based on its field code. */
function fieldLabel(xml) {
    const instr = /<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/.exec(xml)?.[1] ??
        /<w:fldSimple[^>]*w:instr="([^"]*)"/.exec(xml)?.[1] ??
        '';
    const keyword = instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    if (keyword && FIELD_LABELS[keyword])
        return FIELD_LABELS[keyword];
    if (keyword)
        return `Field (${keyword})`;
    // No field code in this paragraph: it only closes a field started earlier
    // (e.g. the paragraph holding the TOC's fldChar end + page break).
    if (xml.includes('fldCharType="end"') && !xml.includes('fldCharType="begin"')) {
        return xml.includes('w:type="page"') ? 'Field end marker + page break' : 'Field end marker';
    }
    return 'Field (TOC/page number/etc.)';
}
const EMU_PER_PX = 9525;
function imageMeta(xml) {
    const meta = {};
    const extent = /<wp:extent[^>]*\/?>/.exec(xml)?.[0];
    if (extent) {
        const cx = parseInt(/cx="(\d+)"/.exec(extent)?.[1] ?? '', 10);
        const cy = parseInt(/cy="(\d+)"/.exec(extent)?.[1] ?? '', 10);
        if (Number.isFinite(cx) && cx > 0)
            meta.imageWidthPx = Math.round(cx / EMU_PER_PX);
        if (Number.isFinite(cy) && cy > 0)
            meta.imageHeightPx = Math.round(cy / EMU_PER_PX);
    }
    const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1];
    if (jc === 'center')
        meta.imageAlign = 'center';
    else if (jc === 'right' || jc === 'end')
        meta.imageAlign = 'right';
    // rotation/flip live on the pic's own xfrm (an anchored textbox sibling has its own wps xfrm)
    const picXfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>/.exec(xml)?.[1];
    if (picXfrm) {
        const rot = parseInt(/\brot="(-?\d+)"/.exec(picXfrm)?.[1] ?? '', 10);
        if (Number.isFinite(rot) && rot !== 0) {
            meta.imageRotDeg = ((Math.round(rot / 60000) % 360) + 360) % 360;
        }
        if (/\bflipH="(?:1|true)"/.test(picXfrm))
            meta.imageFlipH = true;
        if (/\bflipV="(?:1|true)"/.test(picXfrm))
            meta.imageFlipV = true;
    }
    const anchor = /<wp:anchor[^>]*>/.exec(xml)?.[0];
    if (anchor) {
        if (/behindDoc="1"/.test(anchor))
            meta.imageWrap = 'behind';
        else if (/<wp:wrapTopAndBottom/.test(xml))
            meta.imageWrap = 'topBottom';
        else if (/<wp:wrap(Square|Tight|Through)/.test(xml)) {
            const kind = /<wp:wrap(Square|Tight|Through)/.exec(xml)[1];
            const alignRight = /<wp:positionH[^>]*>(?:(?!<\/wp:positionH>)[\s\S])*?<wp:align>right<\/wp:align>/.test(xml);
            const side = alignRight ? 'right' : 'left';
            meta.imageWrap =
                kind === 'Tight'
                    ? `tight-${side}`
                    : kind === 'Through'
                        ? `through-${side}`
                        : `square-${side}`;
        }
        else
            meta.imageWrap = 'front';
        // Parse numeric posOffset for free-position floating images
        const posHBody = /<wp:positionH[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(xml)?.[1] ?? '';
        const posVBody = /<wp:positionV[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(xml)?.[1] ?? '';
        const offsetX = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posHBody)?.[1];
        const offsetY = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posVBody)?.[1];
        if (offsetX !== undefined)
            meta.imageOffsetXEmu = parseInt(offsetX, 10);
        if (offsetY !== undefined)
            meta.imageOffsetYEmu = parseInt(offsetY, 10);
        // margin-relative wp:align pair = Word position-gallery preset
        const posHFrom = /<wp:positionH[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1];
        const posVFrom = /<wp:positionV[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1];
        const alignH = /<wp:align>(left|center|right)<\/wp:align>/.exec(posHBody)?.[1];
        const alignV = /<wp:align>(top|center|bottom)<\/wp:align>/.exec(posVBody)?.[1];
        if (posHFrom === 'margin' && posVFrom === 'margin' && alignH && alignV) {
            meta.imagePosH = alignH;
            meta.imagePosV = alignV;
        }
    }
    return meta;
}
/** resolve an image relationship id to a data URL (embedded parts only) */
async function mediaDataUrl(zip, rels, rId) {
    const rel = rels.get(rId);
    if (!rel || rel.targetMode === 'External')
        return null;
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;
    const file = zip.file(path.replace(/^word\/\.\.\//, ''));
    if (!file)
        return null;
    const mime = IMAGE_MIME[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!mime)
        return null;
    if ((0, metafile_1.isMetafileMime)(mime))
        return (0, metafile_1.metafileToDataUrl)(await file.async('arraybuffer'), mime);
    return `data:${mime};base64,${await file.async('base64')}`;
}
/**
 * Pre-resolve blip rIds found inside w:tbl (extractCell is sync, media reads
 * are async). Scoped to tables to bound memory.
 */
async function tableBlipMedia(elements, documentXml, zip, rels) {
    const out = new Map();
    const rIds = new Set();
    for (const el of elements) {
        if (el.name !== 'w:tbl' && el.name !== 'w:sdt')
            continue;
        let slice = documentXml.slice(el.start, el.end);
        if (el.name === 'w:sdt') {
            const from = slice.indexOf('<w:tbl');
            if (from === -1)
                continue;
            slice = slice.slice(from, slice.lastIndexOf('</w:tbl>') + '</w:tbl>'.length);
        }
        for (const m of slice.matchAll(/<a:blip[^>]*r:(?:embed|link)="([^"]+)"/g))
            rIds.add(m[1]);
    }
    for (const rId of rIds) {
        const rel = rels.get(rId);
        if (!rel)
            continue;
        if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
            out.set(rId, rel.target);
            continue;
        }
        const dataUrl = await mediaDataUrl(zip, rels, rId);
        if (dataUrl)
            out.set(rId, dataUrl);
    }
    return out;
}
/** resolve a paragraph's blip rIds into ctx.mediaByRid so extractRuns (sync) can build image runs */
async function resolveBlipMedia(xml, ctx) {
    const media = ctx.mediaByRid;
    if (!media)
        return;
    for (const m of xml.matchAll(/<a:blip[^>]*r:(?:embed|link)="([^"]+)"/g)) {
        const rId = m[1];
        if (media.has(rId))
            continue;
        const rel = ctx.rels.get(rId);
        if (!rel)
            continue;
        if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
            media.set(rId, rel.target);
            continue;
        }
        const dataUrl = await mediaDataUrl(ctx.zip, ctx.rels, rId);
        if (dataUrl)
            media.set(rId, dataUrl);
    }
}
async function extractImage(xml, ctx) {
    // embedded (r:embed -> word/media/...) or linked (r:link -> external URL)
    const rId = /<a:blip[^>]*r:embed="([^"]+)"/.exec(xml)?.[1] ?? /<a:blip[^>]*r:link="([^"]+)"/.exec(xml)?.[1];
    if (!rId)
        return null;
    const rel = ctx.rels.get(rId);
    if (!rel)
        return null;
    // linked pictures (Word downloads them on open; we let <img> do the same)
    if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
        return rel.target;
    }
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;
    const file = ctx.zip.file(path.replace(/^word\/\.\.\//, ''));
    if (!file)
        return null;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_MIME[ext];
    if (!mime)
        return null;
    if ((0, metafile_1.isMetafileMime)(mime))
        return (0, metafile_1.metafileToDataUrl)(await file.async('arraybuffer'), mime);
    const base64 = await file.async('base64');
    return `data:${mime};base64,${base64}`;
}
/** resolve a document rel to its zip path ("word/…"), or null for external targets */
function relPartPath(ctx, rId) {
    const rel = rId ? ctx.rels.get(rId) : undefined;
    if (!rel || rel.targetMode === 'External')
        return null;
    return (rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`).replace(/^word\/\.\.\//, '');
}
/**
 * SmartArt degrade: the node texts from the diagram data part (r:dm)
 * become the preview, so the reader still sees the labels the diagram holds.
 */
async function extractDiagramText(xml, ctx) {
    const path = relPartPath(ctx, /r:dm="([^"]+)"/.exec(xml)?.[1]);
    const file = path ? ctx.zip.file(path) : null;
    if (!file)
        return null;
    const dataXml = await file.async('string');
    const texts = [];
    for (const t of dataXml.match(/<a:t>[^<]*<\/a:t>/g) ?? []) {
        const s = decodeEntities(t.slice(5, -6)).trim();
        if (s)
            texts.push(s);
    }
    return texts.length > 0 ? texts.join('\n') : null;
}
/**
 * OLE embed degrade: the original packages a preview picture
 * (v:imagedata) and declares its kind (o:OLEObject ProgID) — surface both
 * instead of a bare type label.
 */
async function oleDisplay(xml, ctx) {
    const out = {};
    const progId = /<o:OLEObject[^>]*ProgID="([^"]+)"/.exec(xml)?.[1];
    if (progId)
        out.oleProgId = progId;
    const path = relPartPath(ctx, /<v:imagedata[^>]*r:id="([^"]+)"/.exec(xml)?.[1]);
    const file = path ? ctx.zip.file(path) : null;
    if (file && path) {
        const mime = IMAGE_MIME[path.split('.').pop()?.toLowerCase() ?? ''];
        if ((0, metafile_1.isMetafileMime)(mime)) {
            const converted = await (0, metafile_1.metafileToDataUrl)(await file.async('arraybuffer'), mime);
            if (converted)
                out.imageDataUrl = converted;
        }
        else if (mime) {
            out.imageDataUrl = `data:${mime};base64,${await file.async('base64')}`;
        }
    }
    return out;
}
/**
 * Load and parse the chart part referenced by a chart drawing paragraph.
 * The part's original XML is kept in ctx.chartParts so data edits can be
 * patched into it at save time (the body paragraph itself never changes).
 */
async function extractChart(xml, ctx) {
    const rId = /<c:chart [^>]*r:id="([^"]+)"/.exec(xml)?.[1];
    const rel = rId ? ctx.rels.get(rId) : undefined;
    if (!rel || rel.targetMode === 'External')
        return null;
    const path = (rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`).replace(/^word\/\.\.\//, '');
    const file = ctx.zip.file(path);
    if (!file)
        return null;
    const partXml = await file.async('string');
    const display = (0, chart_1.parseChartPartXml)(partXml, path);
    if (display) {
        ctx.chartParts[path] = partXml;
        const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
        const cx = extent ? parseInt(extent[1], 10) : NaN;
        const cy = extent ? parseInt(extent[2], 10) : NaN;
        if (Number.isFinite(cx) && cx > 0)
            display.widthPx = Math.round(cx / EMU_PER_PX);
        if (Number.isFinite(cy) && cy > 0)
            display.heightPx = Math.round(cy / EMU_PER_PX);
    }
    return display;
}
/** Word's substitution face when the East Asian font slot is empty, by w:lang w:eastAsia */
const EA_LANG_DEFAULT_FONT = {
    ko: 'Batang',
    'ko-kr': 'Batang',
    ja: 'MS Mincho',
    'ja-jp': 'MS Mincho',
    'zh-cn': 'SimSun',
    'zh-tw': 'PMingLiU',
    'zh-hk': 'PMingLiU',
};
async function parseStyles(zip, theme, themeFonts) {
    const styles = new Map();
    const file = zip.file('word/styles.xml');
    if (!file)
        return { styles };
    let parsed;
    try {
        parsed = xml_utils_1.xmlParser.parse(await file.async('string'));
    }
    catch (err) {
        console.warn('styles.xml unparseable, styles degraded to empty:', err);
        return { styles };
    }
    const root = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:styles');
    if (!root)
        return { styles };
    let docDefaults;
    const defaultsNode = (0, xml_utils_1.findChild)(root, 'w:docDefaults');
    if (defaultsNode) {
        const dd = {};
        const rPr = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(defaultsNode, 'w:rPrDefault') ?? {}, 'w:rPr');
        const sz = rPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:sz') ?? {})['w:val'] : undefined;
        if (sz)
            dd.sizeHalfPoints = parseInt(sz, 10) || undefined;
        const ddRf = themedRFonts(rPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:rFonts') ?? {}) : {}, themeFonts);
        if (ddRf.ascii ?? ddRf.hAnsi)
            dd.asciiFont = ddRf.ascii ?? ddRf.hAnsi;
        // docDefaults keeps the lang-based backfill below for the empty-slot case
        if (ddRf.eastAsia && !ddRf.eaSlotEmpty)
            dd.eastAsiaFont = ddRf.eastAsia;
        // Empty EA slot + explicit w:lang w:eastAsia: Word substitutes the locale's
        // default face (e.g. ko-KR theme with <a:ea typeface=""/> renders Batang)
        const eaLang = rPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:lang') ?? {})['w:eastAsia'] : undefined;
        if (!dd.eastAsiaFont && eaLang) {
            const eaDefault = EA_LANG_DEFAULT_FONT[eaLang.toLowerCase()];
            if (eaDefault)
                dd.eastAsiaFont = eaDefault;
        }
        if (rPr) {
            const onFlag = (tag) => {
                const node = (0, xml_utils_1.findChild)(rPr, tag);
                if (!node)
                    return undefined;
                const val = (0, xml_utils_1.attrsOf)(node)['w:val'];
                return val === '0' || val === 'false' ? undefined : true;
            };
            if (onFlag('w:b'))
                dd.bold = true;
            if (onFlag('w:i'))
                dd.italic = true;
            const color = colorFrom(rPr, theme);
            if (color)
                dd.color = color;
        }
        const pPr = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(defaultsNode, 'w:pPrDefault') ?? {}, 'w:pPr');
        const spacingAttrs = pPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:spacing') ?? {}) : {};
        if (spacingAttrs['w:line']) {
            const line = parseInt(spacingAttrs['w:line'], 10);
            const rule = (spacingAttrs['w:lineRule'] ?? 'auto');
            if (line > 0) {
                dd.lineRawTwips = line;
                dd.lineRule = rule;
                if (rule === 'auto')
                    dd.lineSpacing = line / 240;
            }
        }
        if (spacingAttrs['w:before'] !== undefined) {
            dd.spaceBeforeTwips = parseInt(spacingAttrs['w:before'], 10) || 0;
        }
        if (spacingAttrs['w:after'] !== undefined) {
            dd.spaceAfterTwips = parseInt(spacingAttrs['w:after'], 10) || 0;
        }
        if (Object.keys(dd).length > 0)
            docDefaults = dd;
    }
    const basedOnIds = new Map();
    const linkedIds = new Map();
    // styles with an explicit w:outlineLvl 9 (body text, e.g. TOCHeading basedOn Heading1)
    const outlineOffIds = new Set();
    for (const styleNode of (0, xml_utils_1.findChildren)(root, 'w:style')) {
        const attrs = (0, xml_utils_1.attrsOf)(styleNode);
        const type = attrs['w:type'];
        if (type !== 'paragraph' && type !== 'character' && type !== 'table')
            continue;
        const styleId = attrs['w:styleId'];
        if (!styleId)
            continue;
        const name = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(styleNode, 'w:name') ?? {})['w:val'] ?? styleId;
        let headingLevel;
        if (type === 'paragraph') {
            const nameMatch = /^heading\s*([1-9])$/i.exec(name) ?? /^Heading([1-9])$/.exec(styleId);
            if (nameMatch)
                headingLevel = parseInt(nameMatch[1], 10);
            else {
                const pPr = (0, xml_utils_1.findChild)(styleNode, 'w:pPr');
                const outline = pPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:outlineLvl') ?? {})['w:val'] : undefined;
                if (outline !== undefined) {
                    const lvl = parseInt(outline, 10);
                    if (lvl >= 0 && lvl <= 8)
                        headingLevel = lvl + 1;
                    else
                        outlineOffIds.add(styleId);
                }
            }
        }
        const basedOn = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(styleNode, 'w:basedOn') ?? {})['w:val'];
        if (basedOn)
            basedOnIds.set(styleId, basedOn);
        const link = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(styleNode, 'w:link') ?? {})['w:val'];
        if (link)
            linkedIds.set(styleId, link);
        const onFlag = (tag) => {
            const node = (0, xml_utils_1.findChild)(styleNode, tag);
            if (!node)
                return undefined;
            const val = (0, xml_utils_1.attrsOf)(node)['w:val'];
            return val === '0' || val === 'false' ? undefined : true;
        };
        let numPr;
        if (type === 'paragraph') {
            const styleNumPr = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(styleNode, 'w:pPr') ?? {}, 'w:numPr');
            if (styleNumPr) {
                const numId = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(styleNumPr, 'w:numId') ?? {})['w:val'];
                if (numId && numId !== '0') {
                    const ilvl = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(styleNumPr, 'w:ilvl') ?? {})['w:val'] ?? '0', 10);
                    numPr = { numId, ilvl: ilvl || 0 };
                }
            }
        }
        styles.set(styleId, {
            styleId,
            name,
            type,
            headingLevel,
            semiHidden: onFlag('w:semiHidden'),
            qFormat: onFlag('w:qFormat'),
            display: type === 'table' ? undefined : styleDisplayOf(styleNode, theme, themeFonts),
            tableDisplay: type === 'table' ? tableStyleDisplayOf(styleNode, theme) : undefined,
            numPr,
            isDefault: attrs['w:default'] === '1' || attrs['w:default'] === 'true' ? true : undefined,
        });
    }
    // resolve basedOn chains: a style inherits every display prop it doesn't set itself
    const resolved = new Set();
    const resolve = (styleId, seen) => {
        const info = styles.get(styleId);
        if (!info)
            return undefined;
        const parentId = basedOnIds.get(styleId);
        if (resolved.has(styleId) || !parentId || seen.has(styleId))
            return info;
        seen.add(styleId);
        const parent = resolve(parentId, seen);
        resolved.add(styleId);
        if (parent?.display) {
            info.display = { ...parent.display, ...(info.display ?? {}) };
            if (Object.keys(info.display).length === 0)
                info.display = undefined;
        }
        if (parent?.tableDisplay) {
            info.tableDisplay = mergeTableDisplay(parent.tableDisplay, info.tableDisplay);
        }
        if (info.type === 'paragraph' &&
            info.headingLevel === undefined &&
            !outlineOffIds.has(styleId) &&
            parent?.headingLevel) {
            info.headingLevel = parent.headingLevel;
        }
        if (info.type === 'paragraph' && !info.numPr && parent?.numPr)
            info.numPr = parent.numPr;
        return info;
    };
    for (const styleId of styles.keys())
        resolve(styleId, new Set());
    // linkedStyle (w:link): a paragraph style and a character style form one unit (Word
    // "linked styles"). Fill in run-level display properties in both directions (never
    // overriding a style's own) — the common gap is a character-style shell with no rPr,
    // where all run properties live on the linked paragraph style.
    const RUN_KEYS = [
        'sizeHalfPoints',
        'color',
        'bold',
        'italic',
        'underline',
        'strike',
        'font',
        'fontAscii',
        'csFont',
    ];
    for (const [fromId, toId] of linkedIds) {
        const a = styles.get(fromId);
        const b = styles.get(toId);
        if (!a || !b)
            continue;
        for (const [self, other] of [
            [a, b],
            [b, a],
        ]) {
            if (self.type !== 'character' && self.type !== 'paragraph')
                continue;
            const fill = {};
            for (const key of RUN_KEYS) {
                if (self.display?.[key] === undefined && other.display?.[key] !== undefined) {
                    ;
                    fill[key] = other.display[key];
                }
            }
            if (Object.keys(fill).length > 0)
                self.display = { ...fill, ...(self.display ?? {}) };
        }
        if (a.type === 'character' && b.type === 'paragraph')
            a.linkedCharShell = true;
        if (b.type === 'character' && a.type === 'paragraph')
            b.linkedCharShell = true;
    }
    return { styles, docDefaults };
}
function mergeTableDisplay(parent, child) {
    const merged = { ...parent, ...(child ?? {}) };
    const DEEP = ['wholeTable', 'firstRow', 'firstCol', 'lastCol', 'lastRow', 'paraSpacing'];
    for (const key of DEEP) {
        if (parent[key] || child?.[key]) {
            merged[key] = { ...(parent[key] ?? {}), ...(child?.[key] ?? {}) };
        }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
/** fills / first-row formatting a table style contributes on screen */
function tableStyleDisplayOf(styleNode, theme) {
    const display = {};
    const shdFill = (node) => {
        const fill = node ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(node, 'w:shd') ?? {})['w:fill'] : undefined;
        return fill && fill !== 'auto' ? fill : undefined;
    };
    const baseFill = shdFill((0, xml_utils_1.findChild)(styleNode, 'w:tcPr'));
    if (baseFill)
        display.fill = baseFill;
    const styleRPr = (0, xml_utils_1.findChild)(styleNode, 'w:rPr');
    if (styleRPr) {
        const wholeTable = {};
        const color = colorFrom(styleRPr, theme);
        if (color)
            wholeTable.color = color;
        if ((0, xml_utils_1.boolProp)(styleRPr, 'w:b'))
            wholeTable.bold = true;
        if (Object.keys(wholeTable).length > 0)
            display.wholeTable = wholeTable;
    }
    for (const cond of (0, xml_utils_1.findChildren)(styleNode, 'w:tblStylePr')) {
        const type = (0, xml_utils_1.attrsOf)(cond)['w:type'];
        const tcPr = (0, xml_utils_1.findChild)(cond, 'w:tcPr');
        const fill = shdFill(tcPr);
        if (type === 'firstRow' || type === 'firstCol' || type === 'lastCol' || type === 'lastRow') {
            const rPr = (0, xml_utils_1.findChild)(cond, 'w:rPr');
            const fmt = {};
            if (fill)
                fmt.fill = fill;
            if (rPr && (0, xml_utils_1.boolProp)(rPr, 'w:b'))
                fmt.bold = true;
            const color = colorFrom(rPr, theme);
            if (color)
                fmt.color = color;
            if (Object.keys(fmt).length > 0)
                display[type] = fmt;
        }
        else if (type === 'band1Horz' && fill) {
            display.band1Fill = fill;
        }
        else if (type === 'band2Horz' && fill) {
            display.band2Fill = fill;
        }
    }
    const styleTblPr = (0, xml_utils_1.findChild)(styleNode, 'w:tblPr');
    const borders = borderLinesOf((0, xml_utils_1.findChild)(styleTblPr ?? {}, 'w:tblBorders'), true);
    if (borders)
        display.borders = borders;
    const cellMar = cellMarginsOf((0, xml_utils_1.findChild)(styleTblPr ?? {}, 'w:tblCellMar'));
    if (cellMar)
        display.cellMarTwips = cellMar;
    const stylePPrSpacing = (0, xml_utils_1.findChild)((0, xml_utils_1.findChild)(styleNode, 'w:pPr') ?? {}, 'w:spacing');
    if (stylePPrSpacing) {
        const a = (0, xml_utils_1.attrsOf)(stylePPrSpacing);
        const ps = {};
        const before = parseInt(a['w:before'] ?? '', 10);
        if (before >= 0 && a['w:before'] !== undefined)
            ps.beforeTwips = before;
        const after = parseInt(a['w:after'] ?? '', 10);
        if (after >= 0 && a['w:after'] !== undefined)
            ps.afterTwips = after;
        const line = parseInt(a['w:line'] ?? '', 10);
        if (line > 0) {
            ps.lineRawTwips = line;
            const rule = (a['w:lineRule'] ?? 'auto');
            ps.lineRule = rule;
            if (rule === 'auto')
                ps.lineSpacing = Math.round((line / 240) * 100) / 100;
        }
        if (Object.keys(ps).length > 0)
            display.paraSpacing = ps;
    }
    return Object.keys(display).length > 0 ? display : undefined;
}
/** display-only formatting the style contributes on screen (Word renders these from styles.xml) */
function styleDisplayOf(styleNode, theme, themeFonts) {
    const display = {};
    const rPr = (0, xml_utils_1.findChild)(styleNode, 'w:rPr');
    if (rPr) {
        const sz = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:sz') ?? {})['w:val'];
        if (sz)
            display.sizeHalfPoints = parseInt(sz, 10) || undefined;
        const color = colorFrom(rPr, theme);
        if (color)
            display.color = color;
        const bold = onOffOf(rPr, 'w:b');
        if (bold !== undefined)
            display.bold = bold;
        const italic = onOffOf(rPr, 'w:i');
        if (italic !== undefined)
            display.italic = italic;
        const u = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:u') ?? {})['w:val'];
        if (u)
            display.underline = u !== 'none';
        const strike = onOffOf(rPr, 'w:strike');
        if (strike !== undefined)
            display.strike = strike;
        const rf = themedRFonts((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:rFonts') ?? {}), themeFonts);
        const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi;
        const fontAscii = rf.ascii ?? rf.hAnsi;
        if (fontAscii)
            display.fontAscii = fontAscii;
        if (rf.cs)
            display.csFont = rf.cs;
        if (font)
            display.font = font;
        const spc = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(rPr, 'w:spacing') ?? {})['w:val'] ?? '', 10);
        if (spc)
            display.charSpacingTwips = spc;
    }
    const pPr = (0, xml_utils_1.findChild)(styleNode, 'w:pPr');
    if (pPr) {
        const spacing = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:spacing') ?? {});
        const line = parseInt(spacing['w:line'] ?? '', 10);
        if (line > 0) {
            const rule = (spacing['w:lineRule'] ?? 'auto');
            display.lineRule = rule;
            display.lineRawTwips = line;
            if (rule === 'auto') {
                display.lineSpacing = line / 240;
            }
        }
        if (spacing['w:before'] !== undefined) {
            display.spaceBeforeTwips = parseInt(spacing['w:before'], 10) || 0;
        }
        if (spacing['w:after'] !== undefined) {
            display.spaceAfterTwips = parseInt(spacing['w:after'], 10) || 0;
        }
        if ((0, xml_utils_1.boolProp)(pPr, 'w:keepNext'))
            display.keepNext = true;
        if ((0, xml_utils_1.boolProp)(pPr, 'w:keepLines'))
            display.keepLines = true;
        if ((0, xml_utils_1.boolProp)(pPr, 'w:contextualSpacing'))
            display.contextualSpacing = true;
        const autoSpace = autoSpaceOf(pPr);
        if (autoSpace !== undefined)
            display.autoSpace = autoSpace;
        const jc = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(pPr, 'w:jc') ?? {})['w:val'];
        if (jc === 'center' || jc === 'right' || jc === 'left' || jc === 'justify')
            display.align = jc;
        else if (jc === 'both' || jc === 'distribute')
            display.align = 'justify';
        const ind = (0, xml_utils_1.findChild)(pPr, 'w:ind');
        if (ind) {
            const a = (0, xml_utils_1.attrsOf)(ind);
            const left = parseInt(a['w:left'] ?? a['w:start'] ?? '', 10);
            if (Number.isFinite(left) && left !== 0)
                display.indentLeftTwips = left;
            const right = parseInt(a['w:right'] ?? a['w:end'] ?? '', 10);
            if (Number.isFinite(right) && right !== 0)
                display.indentRightTwips = right;
            const firstLine = parseInt(a['w:firstLine'] ?? '', 10);
            const hanging = parseInt(a['w:hanging'] ?? '', 10);
            if (hanging > 0)
                display.indentFirstLineTwips = -hanging;
            else if (firstLine > 0)
                display.indentFirstLineTwips = firstLine;
        }
    }
    return Object.keys(display).length > 0 ? display : undefined;
}
async function parseRels(zip, path) {
    const rels = new Map();
    const file = zip.file(path);
    if (!file)
        return rels;
    const parsed = xml_utils_1.xmlParser.parse(await file.async('string'));
    const root = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'Relationships');
    if (!root)
        return rels;
    for (const relNode of (0, xml_utils_1.findChildren)(root, 'Relationship')) {
        const attrs = (0, xml_utils_1.attrsOf)(relNode);
        if (!attrs['Id'])
            continue;
        rels.set(attrs['Id'], {
            target: attrs['Target'] ?? '',
            type: attrs['Type'] ?? '',
            targetMode: attrs['TargetMode'],
        });
    }
    return rels;
}
/** word/comments.xml (+ reply/resolved relations from commentsExtended) -> display list, file order */
async function parseComments(zip) {
    const file = zip.file('word/comments.xml');
    if (!file)
        return [];
    const parsed = xml_utils_1.xmlParser.parse(await file.async('string'));
    const root = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:comments');
    if (!root)
        return [];
    const out = [];
    for (const node of (0, xml_utils_1.findChildren)(root, 'w:comment')) {
        const attrs = (0, xml_utils_1.attrsOf)(node);
        if (!attrs['w:id'])
            continue;
        const paras = (0, xml_utils_1.findChildren)(node, 'w:p');
        const paraId = paras.length > 0 ? (0, xml_utils_1.attrsOf)(paras[paras.length - 1])['w14:paraId'] : undefined;
        out.push({
            id: attrs['w:id'],
            author: attrs['w:author'] ?? '',
            initials: attrs['w:initials'],
            date: attrs['w:date'],
            text: paras.map((p) => (0, xml_utils_1.textOf)(p)).join('\n'),
            ...(paraId ? { paraId } : {}),
        });
    }
    // commentsExtended.xml: paraId → parent paraId / done (Word 2013+ replies and resolution)
    const extFile = zip.file('word/commentsExtended.xml');
    if (extFile) {
        const extXml = await extFile.async('string');
        const byParaId = new Map(out.filter((c) => c.paraId).map((c) => [c.paraId, c]));
        for (const m of extXml.match(/<w15:commentEx [^>]*\/>/g) ?? []) {
            const paraId = /w15:paraId="([^"]+)"/.exec(m)?.[1];
            const parentParaId = /w15:paraIdParent="([^"]+)"/.exec(m)?.[1];
            const done = /w15:done="(?:1|true)"/.test(m);
            const c = paraId ? byParaId.get(paraId) : undefined;
            if (!c)
                continue;
            if (done)
                c.done = true;
            if (parentParaId) {
                const parent = byParaId.get(parentParaId);
                if (parent)
                    c.parentId = parent.id;
            }
        }
    }
    return out;
}
/** w:documentProtection from word/settings.xml (editing restriction) */
async function parseProtection(zip) {
    const file = zip.file('word/settings.xml');
    if (!file)
        return null;
    const xml = await file.async('string');
    const tag = /<w:documentProtection[^>]*\/>/.exec(xml)?.[0];
    if (!tag)
        return null;
    const edit = /w:edit="([^"]+)"/.exec(tag)?.[1];
    if (!edit || edit === 'none')
        return null;
    const enforcement = /w:enforcement="([^"]+)"/.exec(tag)?.[1];
    const hash = /w:hash="([^"]+)"/.exec(tag)?.[1];
    const salt = /w:salt="([^"]+)"/.exec(tag)?.[1];
    const spin = /w:cryptSpinCount="(\d+)"/.exec(tag)?.[1];
    const sid = /w:cryptAlgorithmSid="(\d+)"/.exec(tag)?.[1];
    return {
        edit,
        enforced: enforcement === '1' || enforcement === 'true',
        ...(hash ? { hash } : {}),
        ...(salt ? { salt } : {}),
        ...(spin ? { spinCount: parseInt(spin, 10) } : {}),
        ...(sid ? { algorithmSid: parseInt(sid, 10) } : {}),
    };
}
function parseNumberingLevel(lvlNode) {
    // ECMA-376: a w:lvl without w:start starts at 0 (Word renders "0.")
    const start = parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(lvlNode, 'w:start') ?? {})['w:val'] ?? '0', 10);
    const level = {
        numFmt: (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(lvlNode, 'w:numFmt') ?? {})['w:val'] ?? 'decimal',
        lvlText: decodeEntities((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(lvlNode, 'w:lvlText') ?? {})['w:val'] ?? ''),
        start: Number.isFinite(start) ? start : 0,
    };
    const lvlPPr = (0, xml_utils_1.findChild)(lvlNode, 'w:pPr');
    const ind = lvlPPr ? (0, xml_utils_1.findChild)(lvlPPr, 'w:ind') : undefined;
    if (ind) {
        const attrs = (0, xml_utils_1.attrsOf)(ind);
        const left = parseInt(attrs['w:left'] ?? attrs['w:start'] ?? '', 10);
        if (left > 0)
            level.indentLeft = left;
        const hanging = parseInt(attrs['w:hanging'] ?? '', 10);
        if (hanging > 0)
            level.hanging = hanging;
    }
    const lvlRPr = (0, xml_utils_1.findChild)(lvlNode, 'w:rPr');
    const sz = lvlRPr ? parseInt((0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(lvlRPr, 'w:sz') ?? {})['w:val'] ?? '', 10) : NaN;
    if (sz > 0)
        level.szHalfPoints = sz;
    const fonts = lvlRPr ? (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(lvlRPr, 'w:rFonts') ?? {}) : {};
    const font = fonts['w:ascii'] ?? fonts['w:hAnsi'] ?? fonts['w:eastAsia'];
    if (font)
        level.font = font;
    return level;
}
/** word/numbering.xml -> per-numId level definitions + the bullet/ordered classification */
async function parseNumbering(zip) {
    const formats = new Map();
    const defs = new Map();
    const file = zip.file('word/numbering.xml');
    if (!file)
        return { formats, defs };
    const parsed = xml_utils_1.xmlParser.parse(await file.async('string'));
    const root = parsed.find((n) => (0, xml_utils_1.nameOf)(n) === 'w:numbering');
    if (!root)
        return { formats, defs };
    const absLevels = new Map();
    for (const abs of (0, xml_utils_1.findChildren)(root, 'w:abstractNum')) {
        const absId = (0, xml_utils_1.attrsOf)(abs)['w:abstractNumId'];
        if (!absId)
            continue;
        const levels = {};
        for (const lvl of (0, xml_utils_1.findChildren)(abs, 'w:lvl')) {
            const ilvl = parseInt((0, xml_utils_1.attrsOf)(lvl)['w:ilvl'] ?? '', 10);
            if (Number.isFinite(ilvl))
                levels[ilvl] = parseNumberingLevel(lvl);
        }
        absLevels.set(absId, levels);
    }
    for (const num of (0, xml_utils_1.findChildren)(root, 'w:num')) {
        const numId = (0, xml_utils_1.attrsOf)(num)['w:numId'];
        const absId = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(num, 'w:abstractNumId') ?? {})['w:val'];
        if (!numId || !absId)
            continue;
        const levels = { ...(absLevels.get(absId) ?? {}) };
        const startOverrides = {};
        for (const over of (0, xml_utils_1.findChildren)(num, 'w:lvlOverride')) {
            const ilvl = parseInt((0, xml_utils_1.attrsOf)(over)['w:ilvl'] ?? '', 10);
            if (!Number.isFinite(ilvl))
                continue;
            const startVal = (0, xml_utils_1.attrsOf)((0, xml_utils_1.findChild)(over, 'w:startOverride') ?? {})['w:val'];
            if (startVal !== undefined) {
                const n = parseInt(startVal, 10);
                if (Number.isFinite(n))
                    startOverrides[ilvl] = n;
            }
            const lvl = (0, xml_utils_1.findChild)(over, 'w:lvl');
            if (lvl)
                levels[ilvl] = parseNumberingLevel(lvl);
        }
        defs.set(numId, { numId, abstractNumId: absId, levels, startOverrides });
        formats.set(numId, levels[0]?.numFmt === 'bullet' ? 'bullet' : 'ordered');
    }
    return { formats, defs };
}
