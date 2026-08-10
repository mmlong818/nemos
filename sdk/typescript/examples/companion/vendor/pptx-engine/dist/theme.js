"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTheme = parseTheme;
exports.resolveFontRef = resolveFontRef;
exports.resolveSchemeColor = resolveSchemeColor;
/**
 * Theme reading (read-only, never written back).
 * Provides color scheme and font scheme lookups so inheritance resolution can turn
 * schemeClr / theme fonts into final values.
 */
const fast_xml_parser_1 = require("fast-xml-parser");
const xml_utils_1 = require("./xml-utils");
const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
/** Scan the top-level children (depth 1) of an xml fragment and return each child's full fragment (order preserved). */
function topLevelFragments(xml) {
    const out = [];
    const re = /<(\/?)([a-zA-Z][\w:]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
    let depth = 0;
    let curStart = -1;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const closing = m[1] === '/';
        const selfClose = m[4] === '/';
        if (!closing && !selfClose) {
            if (depth === 0)
                curStart = m.index;
            depth++;
        }
        else if (closing) {
            depth--;
            if (depth === 0 && curStart >= 0)
                out.push(xml.slice(curStart, re.lastIndex));
        }
        else if (selfClose && depth === 0) {
            out.push(xml.slice(m.index, re.lastIndex));
        }
    }
    return out;
}
/** Get the list of inner fragments of <tag>...</tag> and parse each into a regular node (preserving idx order). */
function parseStyleList(themeXml, tag) {
    const m = new RegExp(`<a:${tag}\\b[^>]*>([\\s\\S]*?)</a:${tag}>`).exec(themeXml);
    if (!m)
        return undefined;
    const items = topLevelFragments(m[1]).map((frag) => (0, xml_utils_1.asXmlNode)(parser.parse(frag)));
    return items.length ? items : undefined;
}
function readColorNode(node) {
    if (!node)
        return undefined;
    const n = (0, xml_utils_1.asXmlNode)(node);
    const srgb = (0, xml_utils_1.asXmlNode)(n['a:srgbClr']);
    if (n['a:srgbClr'])
        return '#' + String(srgb['@_val']).toUpperCase();
    const sys = (0, xml_utils_1.asXmlNode)(n['a:sysClr']);
    if (n['a:sysClr'])
        return '#' + String(sys['@_lastClr'] ?? '000000').toUpperCase();
    return undefined;
}
/** Font typeface attribute of e.g. fontScheme['a:majorFont']['a:latin'] (undefined when absent). */
function typeface(scheme, font, script) {
    const v = (0, xml_utils_1.asXmlNode)((0, xml_utils_1.asXmlNode)(scheme[font])[script])['@_typeface'];
    return typeof v === 'string' && v ? v : undefined;
}
function parseTheme(themeXml) {
    const doc = (0, xml_utils_1.asXmlNode)(parser.parse(themeXml));
    const themeEl = (0, xml_utils_1.asXmlNode)(doc['a:theme'] ?? doc.theme);
    const elements = (0, xml_utils_1.asXmlNode)(themeEl['a:themeElements']);
    const clrScheme = (0, xml_utils_1.asXmlNode)(elements['a:clrScheme']);
    const colors = {};
    for (const key of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
        const c = readColorNode(clrScheme['a:' + key]);
        if (c)
            colors[key] = c;
    }
    const fontScheme = (0, xml_utils_1.asXmlNode)(elements['a:fontScheme']);
    const majorFont = typeface(fontScheme, 'a:majorFont', 'a:latin');
    const minorFont = typeface(fontScheme, 'a:minorFont', 'a:latin');
    const majorEaFont = typeface(fontScheme, 'a:majorFont', 'a:ea');
    const minorEaFont = typeface(fontScheme, 'a:minorFont', 'a:ea');
    const majorCsFont = typeface(fontScheme, 'a:majorFont', 'a:cs');
    const minorCsFont = typeface(fontScheme, 'a:minorFont', 'a:cs');
    // fmtScheme templates are parsed in order from raw-text slices (fillStyleLst children mix element types; regular parsing would lose the idx order)
    const fmtM = /<a:fmtScheme\b[^>]*>[\s\S]*?<\/a:fmtScheme>/.exec(themeXml);
    const fmt = fmtM?.[0] ?? '';
    const fillStyles = parseStyleList(fmt, 'fillStyleLst');
    const lnStyles = parseStyleList(fmt, 'lnStyleLst');
    const effectStyles = parseStyleList(fmt, 'effectStyleLst');
    const bgFillStyles = parseStyleList(fmt, 'bgFillStyleLst');
    return {
        colors,
        majorFont,
        minorFont,
        majorEaFont,
        minorEaFont,
        majorCsFont,
        minorCsFont,
        ...(fillStyles ? { fillStyles } : {}),
        ...(lnStyles ? { lnStyles } : {}),
        ...(effectStyles ? { effectStyles } : {}),
        ...(bgFillStyles ? { bgFillStyles } : {}),
    };
}
/**
 * Theme font reference ("+mj-lt" / "+mn-ea" etc.) → final font name.
 * Values not starting with "+" are returned as-is; returns undefined when the theme has no match.
 */
function resolveFontRef(typeface, theme) {
    if (!typeface)
        return undefined;
    if (!typeface.startsWith('+'))
        return typeface;
    switch (typeface) {
        case '+mj-lt':
            return theme?.majorFont;
        case '+mn-lt':
            return theme?.minorFont;
        case '+mj-ea':
            return theme?.majorEaFont ?? theme?.majorFont;
        case '+mn-ea':
            return theme?.minorEaFont ?? theme?.minorFont;
        case '+mj-cs':
            return theme?.majorCsFont ?? theme?.majorFont;
        case '+mn-cs':
            return theme?.minorCsFont ?? theme?.minorFont;
        default:
            return theme?.minorFont;
    }
}
/** schemeClr name (e.g. 'tx1','bg1','accent1','phClr') → final #RRGGBB. */
function resolveSchemeColor(name, theme, phClr) {
    if (name === 'phClr')
        return phClr;
    // Standard mapping: tx1→dk1, bg1→lt1, tx2→dk2, bg2→lt2
    const map = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    const key = map[name] ?? name;
    return theme?.colors[key];
}
