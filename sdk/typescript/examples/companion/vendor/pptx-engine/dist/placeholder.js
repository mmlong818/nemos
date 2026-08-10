"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlaceholderMap = parsePlaceholderMap;
exports.parseLstStyleLevels = parseLstStyleLevels;
exports.parseMasterTextStyles = parseMasterTextStyles;
exports.placeholderStyleChain = placeholderStyleChain;
exports.mergeTextStyleChain = mergeTextStyleChain;
exports.resolvePlaceholderTransform = resolvePlaceholderTransform;
/**
 * Placeholder geometry inheritance (Phase 2, filling a gap left by Phase 1).
 *
 * Placeholder shapes on a slide (<p:ph>) often omit their own <a:xfrm>; geometry
 * must be backfilled from the slideLayout per OOXML inheritance rules, and from
 * the slideMaster when the layout lacks it.
 *
 * Matching rules (aligned with PowerPoint / pptxtojson):
 *   1. exact (type, idx) match first;
 *   2. then by idx (when type is missing/inconsistent);
 *   3. then by type;
 *   4. body-like types (body/subTitle, etc.) fall back to each other, as do
 *      title/ctrTitle.
 *
 * Read-only: layout/master geometry is used only for render inheritance, never
 * written back to the original pptx.
 */
const fast_xml_parser_1 = require("fast-xml-parser");
const theme_1 = require("./theme");
const color_1 = require("./color");
const xml_utils_1 = require("./xml-utils");
const phParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['p:sp'].includes(name),
});
const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const BODY_TYPES = new Set(['body', 'subTitle', 'obj', '']);
function parseXfrmNode(xfrmRaw) {
    if (!xfrmRaw)
        return null;
    const xfrm = (0, xml_utils_1.asXmlNode)(xfrmRaw);
    const offRaw = xfrm['a:off'];
    const extRaw = xfrm['a:ext'];
    if (!offRaw && !extRaw)
        return null;
    const off = (0, xml_utils_1.asXmlNode)(offRaw);
    const ext = (0, xml_utils_1.asXmlNode)(extRaw);
    return {
        offset: {
            x: offRaw ? parseInt(String(off['@_x']), 10) || 0 : 0,
            y: offRaw ? parseInt(String(off['@_y']), 10) || 0 : 0,
            cx: extRaw ? parseInt(String(ext['@_cx']), 10) || 0 : 0,
            cy: extRaw ? parseInt(String(ext['@_cy']), 10) || 0 : 0,
        },
        rot: xfrm['@_rot'] ? parseInt(String(xfrm['@_rot']), 10) || 0 : 0,
        flipH: xfrm['@_flipH'] === '1' || xfrm['@_flipH'] === 'true',
        flipV: xfrm['@_flipV'] === '1' || xfrm['@_flipV'] === 'true',
    };
}
/**
 * Extract the placeholder geometry table + lstStyle text style defaults from a
 * layout/master's full XML. Collects shapes that carry <p:ph> and at least one of
 * <a:xfrm> or <a:lstStyle>.
 */
function parsePlaceholderMap(layoutOrMasterXml, theme) {
    const entries = [];
    let doc;
    try {
        doc = (0, xml_utils_1.asXmlNode)(phParser.parse(layoutOrMasterXml));
    }
    catch {
        return { entries };
    }
    // Path: p:sldLayout / p:sldMaster → p:cSld → p:spTree → p:sp[]
    const root = (0, xml_utils_1.asXmlNode)(doc['p:sldLayout'] ?? doc['p:sldMaster']);
    const spTreeRaw = (0, xml_utils_1.asXmlNode)(root['p:cSld'])['p:spTree'];
    if (!spTreeRaw)
        return { entries };
    const spTree = (0, xml_utils_1.asXmlNode)(spTreeRaw);
    for (const sp of (0, xml_utils_1.xmlArray)(spTree['p:sp'])) {
        const phRaw = (0, xml_utils_1.asXmlNode)((0, xml_utils_1.asXmlNode)(sp['p:nvSpPr'])['p:nvPr'])['p:ph'];
        if (!phRaw)
            continue;
        const ph = (0, xml_utils_1.asXmlNode)(phRaw);
        const type = String(ph['@_type'] ?? 'body');
        const idx = ph['@_idx'] != null ? String(ph['@_idx']) : '';
        const transform = parseXfrmNode((0, xml_utils_1.asXmlNode)(sp['p:spPr'])['a:xfrm']);
        const textStyle = parseLstStyleLevels((0, xml_utils_1.asXmlNode)(sp['p:txBody'])['a:lstStyle'], theme);
        if (!transform && !textStyle)
            continue;
        entries.push({ type, idx, transform, ...(textStyle ? { textStyle } : {}) });
    }
    return { entries };
}
// ── lstStyle / txStyles text style parsing ───────────────────────────
const ALIGN_MAP = {
    l: 'left',
    ctr: 'center',
    r: 'right',
    just: 'justify',
};
/** fast-xml-parser does not decode numeric character references in attributes (&#x2022; etc.); done here. */
function decodeAttrCharRefs(s) {
    return s
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}
/** <a:spcPct val="150000"/> → 150 (%). */
function spcPctVal(node) {
    const v = (0, xml_utils_1.asXmlNode)((0, xml_utils_1.asXmlNode)(node)['a:spcPct'])['@_val'];
    return v != null ? parseInt(String(v), 10) / 1000 : undefined;
}
/** <a:spcPts val="2400"/> → 24 (pt). */
function spcPtsVal(node) {
    const v = (0, xml_utils_1.asXmlNode)((0, xml_utils_1.asXmlNode)(node)['a:spcPts'])['@_val'];
    return v != null ? parseInt(String(v), 10) / 100 : undefined;
}
/** Typeface attribute of e.g. <a:latin typeface="…"/> as a string (undefined when absent). */
function typefaceAttr(node) {
    const v = (0, xml_utils_1.asXmlNode)(node)['@_typeface'];
    return v != null ? String(v) : undefined;
}
/** <a:lvlNpPr> (including defRPr) → LevelTextStyle. */
function parseLvlPPr(pPrRaw, theme) {
    if (!pPrRaw || typeof pPrRaw !== 'object')
        return undefined;
    const pPr = (0, xml_utils_1.asXmlNode)(pPrRaw);
    const out = {};
    const algn = String(pPr['@_algn'] ?? '');
    if (algn && ALIGN_MAP[algn])
        out.align = ALIGN_MAP[algn];
    const lineHeight = spcPctVal(pPr['a:lnSpc']);
    const lineExact = spcPtsVal(pPr['a:lnSpc']);
    if (lineHeight != null)
        out.lineHeight = lineHeight;
    if (lineExact != null)
        out.lineExact = lineExact;
    const spcBef = pPr['a:spcBef'];
    const spcAft = pPr['a:spcAft'];
    if (spcPtsVal(spcBef) != null)
        out.spaceBefore = spcPtsVal(spcBef);
    if (spcPctVal(spcBef) != null)
        out.spaceBeforePct = spcPctVal(spcBef);
    if (spcPtsVal(spcAft) != null)
        out.spaceAfter = spcPtsVal(spcAft);
    if (spcPctVal(spcAft) != null)
        out.spaceAfterPct = spcPctVal(spcAft);
    // Bullet + indent defaults (a body placeholder's bullets mostly come from here)
    const buChar = (0, xml_utils_1.asXmlNode)(pPr['a:buChar'])['@_char'];
    if (pPr['a:buNone'] !== undefined)
        out.bullet = { type: 'none' };
    else if (buChar != null) {
        out.bullet = { type: 'char', char: decodeAttrCharRefs(String(buChar)) };
    }
    else if (pPr['a:buAutoNum'])
        out.bullet = { type: 'number' };
    if (pPr['@_marL'] != null) {
        const v = parseInt(String(pPr['@_marL']), 10);
        if (!Number.isNaN(v))
            out.marL = v;
    }
    if (pPr['@_indent'] != null) {
        const v = parseInt(String(pPr['@_indent']), 10);
        if (!Number.isNaN(v))
            out.indent = v;
    }
    const defRPrRaw = pPr['a:defRPr'];
    if (defRPrRaw && typeof defRPrRaw === 'object') {
        const defRPr = (0, xml_utils_1.asXmlNode)(defRPrRaw);
        if (defRPr['@_sz'])
            out.fontSize = parseInt(String(defRPr['@_sz']), 10) / 100;
        if (defRPr['@_b'] != null)
            out.bold = defRPr['@_b'] === '1' || defRPr['@_b'] === 'true';
        if (defRPr['@_i'] != null)
            out.italic = defRPr['@_i'] === '1' || defRPr['@_i'] === 'true';
        const color = (0, color_1.resolveColorNode)(defRPr['a:solidFill'], theme);
        if (color)
            out.color = color;
        const latin = (0, theme_1.resolveFontRef)(typefaceAttr(defRPr['a:latin']), theme);
        if (latin)
            out.latinFont = latin;
        const ea = (0, theme_1.resolveFontRef)(typefaceAttr(defRPr['a:ea']), theme);
        if (ea)
            out.eaFont = ea;
        const cs = (0, theme_1.resolveFontRef)(typefaceAttr(defRPr['a:cs']), theme);
        if (cs)
            out.csFont = cs;
    }
    return Object.keys(out).length ? out : undefined;
}
/** <a:lstStyle> (or one txStyles family) → 9-level style table. */
function parseLstStyleLevels(lst, theme) {
    if (!lst || typeof lst !== 'object')
        return undefined;
    const l = (0, xml_utils_1.asXmlNode)(lst);
    const levels = [];
    for (let i = 1; i <= 9; i++)
        levels[i - 1] = parseLvlPPr(l[`a:lvl${i}pPr`], theme);
    return levels.some(Boolean) ? { levels } : undefined;
}
/** master <p:txStyles> → default styles for the title/body/other families. */
function parseMasterTextStyles(masterXml, theme) {
    let doc;
    try {
        doc = (0, xml_utils_1.asXmlNode)(phParser.parse(masterXml));
    }
    catch {
        return {};
    }
    const txRaw = (0, xml_utils_1.asXmlNode)(doc['p:sldMaster'])['p:txStyles'];
    if (!txRaw)
        return {};
    const tx = (0, xml_utils_1.asXmlNode)(txRaw);
    return {
        ...(parseLstStyleLevels(tx['p:titleStyle'], theme)
            ? { title: parseLstStyleLevels(tx['p:titleStyle'], theme) }
            : {}),
        ...(parseLstStyleLevels(tx['p:bodyStyle'], theme)
            ? { body: parseLstStyleLevels(tx['p:bodyStyle'], theme) }
            : {}),
        ...(parseLstStyleLevels(tx['p:otherStyle'], theme)
            ? { other: parseLstStyleLevels(tx['p:otherStyle'], theme) }
            : {}),
    };
}
/** Find the lstStyle in a layer's map by placeholder (type, idx). Same match order as geometry inheritance. */
function findStyleInMap(map, type, idx) {
    if (!map || map.entries.length === 0)
        return undefined;
    const t = type ?? 'body';
    const i = idx ?? '';
    const styled = map.entries.filter((e) => e.textStyle);
    let hit = styled.find((e) => e.type === t && e.idx === i);
    if (!hit && i !== '')
        hit = styled.find((e) => e.idx === i);
    if (!hit)
        hit = styled.find((e) => e.type === t);
    if (!hit && TITLE_TYPES.has(t))
        hit = styled.find((e) => TITLE_TYPES.has(e.type));
    if (!hit && BODY_TYPES.has(t))
        hit = styled.find((e) => BODY_TYPES.has(e.type));
    return hit?.textStyle;
}
/**
 * Placeholder text style inheritance chain (highest priority first):
 * layout placeholder lstStyle → master placeholder lstStyle → master txStyles
 * (by ph family). The caller may prepend the slide shape's own lstStyle.
 */
function placeholderStyleChain(layout, master, masterTx, type, idx) {
    const chain = [];
    const fromLayout = findStyleInMap(layout, type, idx);
    if (fromLayout)
        chain.push(fromLayout);
    const fromMaster = findStyleInMap(master, type, idx);
    if (fromMaster)
        chain.push(fromMaster);
    const t = type ?? 'body';
    const family = TITLE_TYPES.has(t)
        ? masterTx?.title
        : BODY_TYPES.has(t)
            ? masterTx?.body
            : masterTx?.other;
    if (family)
        chain.push(family);
    return chain;
}
/**
 * Merge one level's default style field by field along the inheritance chain
 * (earlier layers win). When a layer lacks the level, fall back to that layer's
 * lvl1 (lenient fallback).
 */
function mergeTextStyleChain(chain, level) {
    const out = {};
    let any = false;
    for (const layer of chain) {
        if (!layer)
            continue;
        const lvl = layer.levels[level] ?? layer.levels[0];
        if (!lvl)
            continue;
        any = true;
        if (out.fontSize == null && lvl.fontSize != null)
            out.fontSize = lvl.fontSize;
        if (out.bold == null && lvl.bold != null)
            out.bold = lvl.bold;
        if (out.italic == null && lvl.italic != null)
            out.italic = lvl.italic;
        if (out.color == null && lvl.color != null)
            out.color = lvl.color;
        if (out.latinFont == null && lvl.latinFont != null)
            out.latinFont = lvl.latinFont;
        if (out.eaFont == null && lvl.eaFont != null)
            out.eaFont = lvl.eaFont;
        if (out.csFont == null && lvl.csFont != null)
            out.csFont = lvl.csFont;
        if (out.align == null && lvl.align != null)
            out.align = lvl.align;
        if (out.bullet == null && lvl.bullet != null)
            out.bullet = lvl.bullet;
        if (out.marL == null && lvl.marL != null)
            out.marL = lvl.marL;
        if (out.indent == null && lvl.indent != null)
            out.indent = lvl.indent;
        // Line/paragraph spacing inherit as attribute pairs (pct and pts are two value forms of the same lnSpc/spcBef/spcAft node)
        if (out.lineHeight == null &&
            out.lineExact == null &&
            (lvl.lineHeight != null || lvl.lineExact != null)) {
            if (lvl.lineHeight != null)
                out.lineHeight = lvl.lineHeight;
            if (lvl.lineExact != null)
                out.lineExact = lvl.lineExact;
        }
        if (out.spaceBefore == null &&
            out.spaceBeforePct == null &&
            (lvl.spaceBefore != null || lvl.spaceBeforePct != null)) {
            if (lvl.spaceBefore != null)
                out.spaceBefore = lvl.spaceBefore;
            if (lvl.spaceBeforePct != null)
                out.spaceBeforePct = lvl.spaceBeforePct;
        }
        if (out.spaceAfter == null &&
            out.spaceAfterPct == null &&
            (lvl.spaceAfter != null || lvl.spaceAfterPct != null)) {
            if (lvl.spaceAfter != null)
                out.spaceAfter = lvl.spaceAfter;
            if (lvl.spaceAfterPct != null)
                out.spaceAfterPct = lvl.spaceAfterPct;
        }
    }
    return any ? out : undefined;
}
function findInMap(map, type, idx) {
    if (!map || map.entries.length === 0)
        return undefined;
    const t = type ?? 'body';
    const i = idx ?? '';
    // Search only entries with geometry (pure lstStyle entries do not participate in geometry inheritance)
    const geo = map.entries.filter((e) => e.transform);
    // 1. Exact (type, idx)
    let hit = geo.find((e) => e.type === t && e.idx === i);
    if (hit)
        return hit.transform;
    // 2. By idx (when idx is non-empty)
    if (i !== '') {
        hit = geo.find((e) => e.idx === i);
        if (hit)
            return hit.transform;
    }
    // 3. By type
    hit = geo.find((e) => e.type === t);
    if (hit)
        return hit.transform;
    // 4. Family fallback
    if (TITLE_TYPES.has(t)) {
        hit = geo.find((e) => TITLE_TYPES.has(e.type));
        if (hit)
            return hit.transform;
    }
    if (BODY_TYPES.has(t)) {
        hit = geo.find((e) => BODY_TYPES.has(e.type));
        if (hit)
            return hit.transform;
    }
    return undefined;
}
/**
 * Resolve placeholder geometry: layout first, master as fallback.
 * undefined means neither layer has inheritable geometry (the render layer may
 * further fall back to a default or (0,0)).
 */
function resolvePlaceholderTransform(layout, master, type, idx) {
    return findInMap(layout, type, idx) ?? findInMap(master, type, idx);
}
