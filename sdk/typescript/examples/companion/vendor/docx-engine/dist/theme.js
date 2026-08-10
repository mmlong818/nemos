"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEME_CONTENT_TYPE = exports.THEME_REL_TYPE = exports.THEME_PART_PATH = void 0;
exports.readThemeFonts = readThemeFonts;
exports.applyThemeFonts = applyThemeFonts;
exports.readThemeColors = readThemeColors;
exports.resolveThemeColor = resolveThemeColor;
exports.applyThemeColors = applyThemeColors;
exports.buildThemeXml = buildThemeXml;
const xml_utils_1 = require("./xml-utils");
/**
 * Theme part support (word/theme/theme1.xml). Theme fonts rewrite the
 * major/minor font pair; theme colors rewrite the a:clrScheme entries. Documents
 * whose styles reference theme fonts/colors re-render in Word accordingly.
 */
exports.THEME_PART_PATH = 'word/theme/theme1.xml';
exports.THEME_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
exports.THEME_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.theme+xml';
/** read the latin/ea/cs major+minor typefaces from theme1.xml */
function readThemeFonts(themeXml) {
    const major = fontOf(themeXml, 'a:majorFont');
    const minor = fontOf(themeXml, 'a:minorFont');
    if (!major && !minor)
        return null;
    const slot = (tag, kind) => sectionOf(themeXml, tag)?.match(new RegExp(`<${kind} typeface="([^"]*)"`))?.[1] || undefined;
    const eastAsia = slot('a:minorFont', 'a:ea');
    const majorEastAsia = slot('a:majorFont', 'a:ea');
    const minorCs = slot('a:minorFont', 'a:cs');
    const majorCs = slot('a:majorFont', 'a:cs');
    return {
        major: major ?? '',
        minor: minor ?? '',
        ...(eastAsia ? { eastAsia } : {}),
        ...(majorEastAsia ? { majorEastAsia } : {}),
        ...(minorCs ? { minorCs } : {}),
        ...(majorCs ? { majorCs } : {}),
    };
}
function sectionOf(xml, tag) {
    return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`).exec(xml)?.[0] ?? null;
}
function fontOf(xml, tag) {
    const section = sectionOf(xml, tag);
    return section ? (/<a:latin typeface="([^"]*)"/.exec(section)?.[1] ?? null) : null;
}
/** rewrite the latin (and optional east-asian) typefaces of one font group */
function applyFontGroup(xml, tag, typeface, eastAsia) {
    const section = sectionOf(xml, tag);
    if (!section)
        return xml;
    let next = section.replace(/(<a:latin typeface=")[^"]*(")/, `$1${(0, xml_utils_1.escapeXmlAttr)(typeface)}$2`);
    if (eastAsia !== undefined) {
        next = next.replace(/(<a:ea typeface=")[^"]*(")/, `$1${(0, xml_utils_1.escapeXmlAttr)(eastAsia)}$2`);
    }
    return xml.replace(section, next);
}
function applyThemeFonts(themeXml, fonts) {
    let xml = applyFontGroup(themeXml, 'a:majorFont', fonts.major, fonts.eastAsia);
    xml = applyFontGroup(xml, 'a:minorFont', fonts.minor, fonts.eastAsia);
    return xml;
}
const COLOR_TAGS = [
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
];
/** all clrScheme slots, including read-only ones (dk1/lt1 may be sysClr) */
const READ_TAGS = ['dk1', 'lt1', ...COLOR_TAGS, 'hlink', 'folHlink'];
function readThemeColors(themeXml) {
    const scheme = sectionOf(themeXml, 'a:clrScheme');
    if (!scheme)
        return null;
    const out = {};
    const name = /<a:clrScheme name="([^"]*)"/.exec(themeXml)?.[1];
    if (name)
        out.name = name;
    for (const tag of READ_TAGS) {
        const m = new RegExp(`<a:${tag}>\\s*<a:(?:srgbClr val|sysClr[^>]*? lastClr)="([0-9A-Fa-f]{6})"`).exec(scheme);
        if (m)
            out[tag] = m[1].toUpperCase();
    }
    return Object.keys(out).length > 0 ? out : null;
}
/** w:themeColor attribute value -> clrScheme slot (default clrSchemeMapping) */
const THEME_COLOR_SLOTS = {
    dark1: 'dk1',
    text1: 'dk1',
    light1: 'lt1',
    background1: 'lt1',
    dark2: 'dk2',
    text2: 'dk2',
    light2: 'lt2',
    background2: 'lt2',
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    hyperlink: 'hlink',
    followedHyperlink: 'folHlink',
};
const SLOT_FALLBACK = { dk1: '000000', lt1: 'FFFFFF' };
/**
 * Resolve a w:themeColor reference (+ optional w:themeTint / w:themeShade,
 * hex 00-FF) against the palette. sRGB per-channel approximation of Word's
 * tint/shade math — close enough for display; w:val stays authoritative on save.
 */
function resolveThemeColor(themeColor, colors, tint, shade) {
    const slot = THEME_COLOR_SLOTS[themeColor];
    if (!slot)
        return null;
    const base = colors[slot] ?? SLOT_FALLBACK[slot];
    if (!base || !/^[0-9A-Fa-f]{6}$/.test(base))
        return null;
    let rgb = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));
    const factorOf = (hex) => {
        const v = hex ? parseInt(hex, 16) : NaN;
        return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) / 255 : null;
    };
    const s = factorOf(shade);
    if (s !== null)
        rgb = rgb.map((c) => c * s);
    const t = factorOf(tint);
    if (t !== null)
        rgb = rgb.map((c) => c * t + 255 * (1 - t));
    return rgb.map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
}
function applyThemeColors(themeXml, colors) {
    let scheme = sectionOf(themeXml, 'a:clrScheme');
    if (!scheme)
        return themeXml;
    const original = scheme;
    for (const tag of COLOR_TAGS) {
        const value = colors[tag];
        if (!value)
            continue;
        scheme = scheme.replace(new RegExp(`(<a:${tag}>\\s*<a:srgbClr val=")[0-9A-Fa-f]{6}(")`), `$1${value}$2`);
        // sysClr entries (windowText etc.) are left alone; dk2/lt2 are usually srgbClr
    }
    let xml = themeXml.replace(original, scheme);
    if (colors.name) {
        xml = xml.replace(/(<a:clrScheme name=")[^"]*(")/, `$1${(0, xml_utils_1.escapeXmlAttr)(colors.name)}$2`);
    }
    return xml;
}
/**
 * Minimal but complete theme part for documents that have none (e.g. the
 * blank template). Word requires fmtScheme; this ships the standard Office
 * format scheme skeleton.
 */
function buildThemeXml(fonts, colors) {
    const c = (tag, fallback) => `<a:${tag}><a:srgbClr val="${colors[tag] ?? fallback}"/></a:${tag}>`;
    const font = (tag, typeface) => `<${tag}><a:latin typeface="${(0, xml_utils_1.escapeXmlAttr)(typeface)}"/>` +
        `<a:ea typeface="${(0, xml_utils_1.escapeXmlAttr)(fonts.eastAsia ?? '')}"/><a:cs typeface=""/></${tag}>`;
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">' +
        '<a:themeElements>' +
        `<a:clrScheme name="${(0, xml_utils_1.escapeXmlAttr)(colors.name ?? 'Office')}">` +
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
        '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
        c('dk2', '44546A') +
        c('lt2', 'E7E6E6') +
        c('accent1', '4472C4') +
        c('accent2', 'ED7D31') +
        c('accent3', 'A5A5A5') +
        c('accent4', 'FFC000') +
        c('accent5', '5B9BD5') +
        c('accent6', '70AD47') +
        '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
        '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
        '</a:clrScheme>' +
        `<a:fontScheme name="Office">${font('a:majorFont', fonts.major)}${font('a:minorFont', fonts.minor)}</a:fontScheme>` +
        '<a:fmtScheme name="Office">' +
        '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        '<a:lnStyleLst>' +
        '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '</a:lnStyleLst>' +
        '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
        '<a:effectStyle><a:effectLst/></a:effectStyle>' +
        '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
        '</a:fmtScheme>' +
        '</a:themeElements></a:theme>');
}
