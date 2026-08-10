"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INK_MEDIA_PATH_RE = exports.INK_REL_RE = exports.INK_MEDIA_PREFIX = exports.INK_NAME_PREFIX = void 0;
exports.anchoredInkRunXml = anchoredInkRunXml;
exports.stripInkRuns = stripInkRuns;
exports.findInkRuns = findInkRuns;
exports.injectInkRunsIntoParagraph = injectInkRunsIntoParagraph;
const xml_utils_1 = require("./xml-utils");
/**
 * Ink annotations (freehand strokes). Each saved annotation is a floating picture —
 * a run-level <w:drawing><wp:anchor> injected into its anchor paragraph:
 *
 * - wp:positionV relativeFrom="paragraph": the drawing moves with the
 *   paragraph when content above it reflows.
 * - wp:positionH relativeFrom="column": offsets are measured from the text
 *   column edge, independent of the paragraph's own indentation.
 * - behindDoc="0" + wp:wrapNone: floats in front of the text without
 *   affecting layout.
 * - wp:docPr name starts with "aidocs-ink" so we can recognize our own
 *   annotations when the file is reopened; descr carries the editor's
 *   stroke vectors (opaque payload) so the layer stays re-editable.
 *
 * Word renders these as ordinary floating pictures; only our editor restores
 * them into live strokes.
 */
exports.INK_NAME_PREFIX = 'aidocs-ink';
/** media filename prefix for ink PNGs (distinct from inline-image aidocsN) */
exports.INK_MEDIA_PREFIX = 'aidocsink';
/** matches a document.xml.rels entry that targets an ink media part */
exports.INK_REL_RE = new RegExp(`<Relationship [^>]*Target="media/${exports.INK_MEDIA_PREFIX}\\d+\\.png"[^>]*/>`, 'g');
/** matches an ink media part's zip path */
exports.INK_MEDIA_PATH_RE = new RegExp(`^word/media/${exports.INK_MEDIA_PREFIX}\\d+\\.png$`);
const EMU_PER_PX = 9525;
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/**
 * The anchored-picture run for one ink annotation. Namespaces are declared
 * inline so the fragment is valid regardless of what the document root
 * declares (w: is always present).
 */
function anchoredInkRunXml(ink, rId, docPrId) {
    const cx = Math.max(1, Math.round(ink.widthPx * EMU_PER_PX));
    const cy = Math.max(1, Math.round(ink.heightPx * EMU_PER_PX));
    const x = Math.round(ink.offsetXPx * EMU_PER_PX);
    const y = Math.round(ink.offsetYPx * EMU_PER_PX);
    const name = `${exports.INK_NAME_PREFIX} ${docPrId}`;
    const descr = ink.payload ? ` descr="${(0, xml_utils_1.escapeXmlAttr)(ink.payload)}"` : '';
    return ('<w:r><w:drawing>' +
        `<wp:anchor xmlns:wp="${WP_NS}" distT="0" distB="0" distL="0" distR="0" simplePos="0"` +
        ` relativeHeight="${251658240 + docPrId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
        '<wp:simplePos x="0" y="0"/>' +
        `<wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
        `<wp:extent cx="${cx}" cy="${cy}"/>` +
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:wrapNone/>' +
        `<wp:docPr id="${docPrId}" name="${name}"${descr}/>` +
        '<wp:cNvGraphicFramePr/>' +
        `<a:graphic xmlns:a="${A_NS}">` +
        `<a:graphicData uri="${PIC_NS}">` +
        `<pic:pic xmlns:pic="${PIC_NS}">` +
        `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip xmlns:r="${R_NS}" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>');
}
const ANCHOR_RUN_RE = /<w:r><w:drawing><wp:anchor[\s\S]*?<\/wp:anchor><\/w:drawing><\/w:r>/g;
const isInkRun = (run) => run.includes(`name="${exports.INK_NAME_PREFIX}`);
/** Remove every aidocs-ink run from a body-element XML slice. */
function stripInkRuns(xml) {
    if (!xml.includes(exports.INK_NAME_PREFIX))
        return xml;
    return xml.replace(ANCHOR_RUN_RE, (run) => (isInkRun(run) ? '' : run));
}
/** Find aidocs-ink anchored runs inside one paragraph's XML. */
function findInkRuns(paragraphXml) {
    if (!paragraphXml.includes(exports.INK_NAME_PREFIX))
        return [];
    const out = [];
    for (const run of paragraphXml.match(ANCHOR_RUN_RE) ?? []) {
        if (!isInkRun(run))
            continue;
        const emu = (re) => parseInt(re.exec(run)?.[1] ?? '0', 10) || 0;
        const descr = /<wp:docPr [^>]*descr="([^"]*)"/.exec(run)?.[1];
        out.push({
            xml: run,
            offsetXPx: emu(/<wp:positionH[^>]*><wp:posOffset>(-?\d+)/) / EMU_PER_PX,
            offsetYPx: emu(/<wp:positionV[^>]*><wp:posOffset>(-?\d+)/) / EMU_PER_PX,
            widthPx: emu(/<wp:extent cx="(\d+)"/) / EMU_PER_PX,
            heightPx: emu(/<wp:extent cx="\d+" cy="(\d+)"/) / EMU_PER_PX,
            payload: descr ? decodeXmlEntities(descr) : null,
            embedRId: /r:embed="([^"]+)"/.exec(run)?.[1] ?? null,
        });
    }
    return out;
}
/**
 * Insert ink runs at the end of a paragraph fragment (after all content
 * runs). Returns null when the fragment's root is not a w:p — floating ink
 * can only anchor to paragraphs.
 */
function injectInkRunsIntoParagraph(xml, runsXml) {
    if (!/^<w:p[\s/>]/.test(xml))
        return null;
    if (xml.endsWith('/>'))
        return `${xml.slice(0, -2)}>${runsXml}</w:p>`;
    const close = xml.lastIndexOf('</w:p>');
    if (close === -1)
        return null;
    return xml.slice(0, close) + runsXml + xml.slice(close);
}
function decodeXmlEntities(text) {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
