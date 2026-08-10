"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAYOUT_REL_TYPE = exports.FUNCTION_TYPES = exports.PH_HINT_MAP = void 0;
exports.parseLayoutPlaceholders = parseLayoutPlaceholders;
exports.listSlideLayouts = listSlideLayouts;
exports.placeholderSpXml = placeholderSpXml;
exports.prepareInsertSlideWithLayout = prepareInsertSlideWithLayout;
const zip_1 = require("./zip");
const xml_utils_1 = require("./xml-utils");
exports.PH_HINT_MAP = {
    title: 'Click to add title',
    ctrTitle: 'Click to add title',
    body: 'Click to add text',
    subTitle: 'Click to add subtitle',
    obj: 'Click to add content',
    '': 'Click to add text',
};
exports.FUNCTION_TYPES = new Set(['ftr', 'sldNum', 'dt', 'pic']);
/** Quick-parse the <p:cSld> name attribute from the layout XML */
function parseLayoutName(xml, fallback) {
    const m = /<p:cSld\s[^>]*name="([^"]*)"/.exec(xml);
    return m?.[1] || fallback;
}
/** Quick-parse the <p:sldLayout> type attribute from the layout XML */
function parseLayoutType(xml) {
    const m = /<p:sldLayout\b[^>]*\btype="([^"]*)"/.exec(xml);
    return m?.[1] ?? 'custom';
}
/** Parse all placeholder geometry from the layout XML (only non-functional placeholders with an xfrm) */
function parseLayoutPlaceholders(xml) {
    const results = [];
    for (const spMatch of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
        const sp = spMatch[1];
        const phMatch = /<p:ph\b([^>]*)\/?>/.exec(sp);
        if (!phMatch)
            continue;
        const phAttr = phMatch[1];
        const typeM = /\btype="([^"]*)"/.exec(phAttr);
        const idxM = /\bidx="([^"]*)"/.exec(phAttr);
        const type = typeM?.[1] ?? '';
        const idx = idxM?.[1] ?? '';
        if (exports.FUNCTION_TYPES.has(type))
            continue;
        // Try to parse the xfrm (may come from the layout or the master)
        const xfrmM = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(sp);
        if (!xfrmM)
            continue;
        const xfrmContent = xfrmM[1];
        const offM = /<a:off\s[^>]*x="([^"]*)"[^>]*y="([^"]*)"/.exec(xfrmContent);
        const extM = /<a:ext\s[^>]*cx="([^"]*)"[^>]*cy="([^"]*)"/.exec(xfrmContent);
        if (!offM || !extM)
            continue;
        const x = parseInt(offM[1], 10);
        const y = parseInt(offM[2], 10);
        const cx = parseInt(extM[1], 10);
        const cy = parseInt(extM[2], 10);
        if (isNaN(x) || isNaN(y) || isNaN(cx) || isNaN(cy))
            continue;
        results.push({ type, idx, x, y, cx, cy, hint: exports.PH_HINT_MAP[type] ?? 'Click to add text' });
    }
    return results;
}
/**
 * Enumerate all slideLayouts in the archive (sorted by number).
 * Only scans ppt/slideLayouts/slideLayoutN.xml files; does not rely on
 * presentation.xml's sldLayoutIdLst.
 */
function listSlideLayouts(archive) {
    const paths = [...archive.entries.keys()]
        .filter((p) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
        .sort((a, b) => {
        const na = parseInt(/(\d+)/.exec(a)?.[1] ?? '0', 10);
        const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? '0', 10);
        return na - nb;
    });
    return paths.map((path) => {
        const xml = archive.readText(path) ?? '';
        const fileName = path.slice(path.lastIndexOf('/') + 1, -4);
        const name = parseLayoutName(xml, fileName);
        const layoutType = parseLayoutType(xml);
        const placeholders = parseLayoutPlaceholders(xml);
        return { path, name, layoutType, placeholders };
    });
}
// ── Blank slide insertion (with a given layout) ─────────────────────────
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
exports.LAYOUT_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
/** Generate the next unused slide path (current max number + 1). */
function nextSlidePath(archive) {
    let max = 0;
    for (const path of archive.entries.keys()) {
        const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    return `ppt/slides/slide${max + 1}.xml`;
}
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const EMPTY_SPTREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
/**
 * One empty placeholder shape (<p:sp>) slice: explicit xfrm + empty paragraph
 * (like a new PowerPoint slide; the click hint is drawn by the edit canvas, not persisted).
 */
function placeholderSpXml(ph, id) {
    const typeAttr = ph.type ? ` type="${(0, xml_utils_1.escapeXmlAttr)(ph.type)}"` : '';
    const idxAttr = ph.idx ? ` idx="${(0, xml_utils_1.escapeXmlAttr)(ph.idx)}"` : '';
    return (`<p:sp>` +
        `<p:nvSpPr>` +
        `<p:cNvPr id="${id}" name="ph${ph.idx || '0'}"/>` +
        `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
        `<p:nvPr><p:ph${typeAttr}${idxAttr}/></p:nvPr>` +
        `</p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${ph.x}" y="${ph.y}"/><a:ext cx="${ph.cx}" cy="${ph.cy}"/></a:xfrm></p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>` +
        `</p:sp>`);
}
/** Build blank slide XML containing the layout's placeholders. */
function buildSlideXmlWithPlaceholders(placeholders) {
    const shapes = placeholders.map((ph, i) => placeholderSpXml(ph, i + 2));
    const spTree = `<p:spTree>${EMPTY_SPTREE}${shapes.join('')}</p:spTree>`;
    return (XMLDECL +
        `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
        `<p:cSld>${spTree}</p:cSld>` +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
}
/**
 * Insert a blank slide associated with a given layout.
 * The internal caller is responsible for:
 *  1. writing the new path into the archive
 *  2. registering it in presentation.xml + rels + [Content_Types].xml
 *  3. parsing and splicing it into deck.slides
 *
 * This function only performs the archive surgery of 1-3; parseSlide is up to the
 * caller (index.ts). Returns the new slide's path, or null on failure.
 */
function prepareInsertSlideWithLayout(archive, deck, sourceIndex, layoutPath) {
    const src = deck.slides[sourceIndex];
    if (!src)
        return null;
    if (!archive.readText(layoutPath))
        return null;
    // Parse the layout placeholders and build the new slide XML with placeholder text boxes
    const layoutXml = archive.readText(layoutPath) ?? '';
    const layoutInfo = {
        path: layoutPath,
        name: parseLayoutName(layoutXml, ''),
        layoutType: parseLayoutType(layoutXml),
        placeholders: parseLayoutPlaceholders(layoutXml),
    };
    const newSlideXml = buildSlideXmlWithPlaceholders(layoutInfo.placeholders);
    const newPath = nextSlidePath(archive);
    archive.entries.set(newPath, Buffer.from(newSlideXml, 'utf8'));
    // slide rels → point at the chosen layout
    const relTarget = `../${layoutPath.slice(4)}`; // 'ppt/' → '../'
    const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${exports.LAYOUT_REL_TYPE}" Target="${(0, xml_utils_1.escapeXmlAttr)(relTarget)}"/>` +
        '</Relationships>';
    archive.entries.set((0, zip_1.relsPathFor)(newPath), Buffer.from(relsXml, 'utf8'));
    // [Content_Types].xml
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (ct && !ct.includes(`PartName="/${newPath}"`)) {
        archive.entries.set(ctPath, Buffer.from(ct.replace('</Types>', `<Override PartName="/${newPath}" ContentType="${SLIDE_CONTENT_TYPE}"/></Types>`), 'utf8'));
    }
    // presentation.xml.rels + presentation.xml
    const presRelsPath = 'ppt/_rels/presentation.xml.rels';
    const presPath = 'ppt/presentation.xml';
    const presRels = archive.readText(presRelsPath);
    const pres = archive.readText(presPath);
    if (!presRels || !pres)
        return null;
    let maxRid = 0;
    for (const m of presRels.matchAll(/Id="rId(\d+)"/g))
        maxRid = Math.max(maxRid, Number(m[1]));
    const newRid = `rId${maxRid + 1}`;
    const relEntry = `<Relationship Id="${newRid}" Type="${SLIDE_REL_TYPE}" Target="${newPath.slice('ppt/'.length)}"/>`;
    archive.entries.set(presRelsPath, Buffer.from(presRels.replace('</Relationships>', `${relEntry}</Relationships>`), 'utf8'));
    let maxSldId = 255;
    for (const m of pres.matchAll(/<p:sldId\s[^>]*\bid="(\d+)"/g))
        maxSldId = Math.max(maxSldId, Number(m[1]));
    const newSldTag = `<p:sldId id="${maxSldId + 1}" r:id="${newRid}"/>`;
    // Insert after the source slide's sldId
    const srcRid = [...archive.readRels(presPath).values()].find((r) => (0, zip_1.resolveTarget)(presPath, r.target) === src.path)?.id;
    const srcTag = srcRid
        ? new RegExp(`<p:sldId\\s[^>]*r:id="${srcRid}"[^>]*/>`).exec(pres)?.[0]
        : undefined;
    const nextPres = srcTag
        ? pres.replace(srcTag, `${srcTag}${newSldTag}`)
        : pres.replace('</p:sldIdLst>', `${newSldTag}</p:sldIdLst>`);
    archive.entries.set(presPath, Buffer.from(nextPres, 'utf8'));
    return newPath;
}
