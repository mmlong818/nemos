"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TABLE_STYLE_PRESETS = void 0;
exports.ensureTableStyleXml = ensureTableStyleXml;
exports.patchTableStyleXml = patchTableStyleXml;
exports.findTableElementInSlide = findTableElementInSlide;
const xml_utils_1 = require("./xml-utils");
// ── Preset styles ────────────────────────────────────────────────────
// Color presets do not reference PowerPoint built-in style GUIDs (built-ins follow
// the file theme's accent colors, so a "dark blue header" would come out orange in
// an orange theme). Instead, fixed-color custom <a:tblStyle> definitions are
// written into ppt/tableStyles.xml — the button swatch, this app's rendering, and
// PowerPoint all agree.
const inLn = (tag, color) => `<a:${tag}><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></a:${tag}>`;
/** Style XML for one table region (wholeTbl/band1H/firstRow…). */
function partXml(tag, o) {
    const tx = o.text || o.bold
        ? `<a:tcTxStyle${o.bold ? ' b="on"' : ''}>${o.text ? `<a:srgbClr val="${o.text}"/>` : ''}</a:tcTxStyle>`
        : '';
    const bdr = o.insideH || o.insideV
        ? `<a:tcBdr>${o.insideH ? inLn('insideH', o.insideH) : ''}${o.insideV ? inLn('insideV', o.insideV) : ''}</a:tcBdr>`
        : '';
    const fill = o.fill
        ? `<a:fill><a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill></a:fill>`
        : '';
    const tc = bdr || fill ? `<a:tcStyle>${bdr}${fill}</a:tcStyle>` : '';
    return `<a:${tag}>${tx}${tc}</a:${tag}>`;
}
/** Fixed-color banded/header style (band = alternate-row shading; header = header fill). */
function customStyle(styleId, name, o) {
    // CT_TableStyle child order: wholeTbl → band1H → … → firstRow
    return (`<a:tblStyle styleId="${styleId}" styleName="${name}">` +
        partXml('wholeTbl', { text: '000000', fill: o.whole, insideH: o.insideH }) +
        (o.band ? partXml('band1H', { fill: o.band }) : '') +
        partXml('firstRow', {
            bold: true,
            ...(o.header ? { fill: o.header.fill, text: o.header.text } : {}),
        }) +
        '</a:tblStyle>');
}
const ID_ZEBRA_BLUE = '{A10FF1CE-0000-4000-9000-000000000001}';
const ID_ZEBRA_GRAY = '{A10FF1CE-0000-4000-9000-000000000002}';
const ID_HEADER_DARKBLUE = '{A10FF1CE-0000-4000-9000-000000000003}';
const ID_HEADER_ORANGE = '{A10FF1CE-0000-4000-9000-000000000004}';
const ID_NO_BORDER = '{A10FF1CE-0000-4000-9000-000000000005}';
const tblPr = (styleId, flags = '') => `<a:tblPr${flags}><a:tableStyleId>${styleId}</a:tableStyleId></a:tblPr>`;
// Official "No Style, No Grid" GUID (we previously misused a made-up ...307D; the read side stays compatible with it)
const NO_STYLE = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';
/** The 8 preset styles (keys map to the ribbon style gallery). */
exports.TABLE_STYLE_PRESETS = {
    none: { tblPrXml: tblPr(NO_STYLE), description: 'No style' },
    lightGrid: {
        tblPrXml: tblPr(NO_STYLE),
        description: 'Light grid',
        border: { color: '#BFBFBF', widthEmu: 12700 },
    },
    zebraBlue: {
        tblPrXml: tblPr(ID_ZEBRA_BLUE, ' firstRow="1" bandRow="1"'),
        description: 'Banded blue',
        styleId: ID_ZEBRA_BLUE,
        styleDefXml: customStyle(ID_ZEBRA_BLUE, 'Banded blue', {
            whole: 'FFFFFF',
            band: 'D6E4F0',
            header: { fill: '4472C4', text: 'FFFFFF' },
        }),
    },
    zebraGray: {
        tblPrXml: tblPr(ID_ZEBRA_GRAY, ' firstRow="1" bandRow="1"'),
        description: 'Banded gray',
        styleId: ID_ZEBRA_GRAY,
        styleDefXml: customStyle(ID_ZEBRA_GRAY, 'Banded gray', {
            whole: 'FFFFFF',
            band: 'EDEDED',
            header: { fill: '595959', text: 'FFFFFF' },
        }),
    },
    headerDarkBlue: {
        tblPrXml: tblPr(ID_HEADER_DARKBLUE, ' firstRow="1"'),
        description: 'Dark blue header',
        styleId: ID_HEADER_DARKBLUE,
        styleDefXml: customStyle(ID_HEADER_DARKBLUE, 'Dark blue header', {
            whole: 'FFFFFF',
            insideH: 'D9D9D9',
            band: 'E9EDF5',
            header: { fill: '1F3864', text: 'FFFFFF' },
        }),
    },
    headerOrange: {
        tblPrXml: tblPr(ID_HEADER_ORANGE, ' firstRow="1"'),
        description: 'Orange header',
        styleId: ID_HEADER_ORANGE,
        styleDefXml: customStyle(ID_HEADER_ORANGE, 'Orange header', {
            whole: 'FFFFFF',
            insideH: 'D9D9D9',
            band: 'FBE5D6',
            header: { fill: 'ED7D31', text: 'FFFFFF' },
        }),
    },
    noBorder: {
        tblPrXml: tblPr(ID_NO_BORDER, ' firstRow="1" bandRow="1"'),
        description: 'Minimal (no borders)',
        styleId: ID_NO_BORDER,
        styleDefXml: customStyle(ID_NO_BORDER, 'Minimal (no borders)', { band: 'F2F2F2' }),
    },
    fullBorder: {
        tblPrXml: tblPr(NO_STYLE),
        description: 'All borders',
        border: { color: '#000000', widthEmu: 12700 },
    },
};
const EMPTY_TABLE_STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';
/** Ensure the given style definition exists in tableStyles.xml; returned as-is if already present. */
function ensureTableStyleXml(tableStylesXml, styleId, styleDefXml) {
    const xml = tableStylesXml?.includes('<a:tblStyleLst') ? tableStylesXml : EMPTY_TABLE_STYLES_XML;
    if (xml.includes(styleId))
        return xml;
    const sc = /<a:tblStyleLst([^>]*)\/>/.exec(xml);
    if (sc)
        return xml.replace(sc[0], `<a:tblStyleLst${sc[1]}>${styleDefXml}</a:tblStyleLst>`);
    return xml.replace('</a:tblStyleLst>', `${styleDefXml}</a:tblStyleLst>`);
}
/**
 * Surgically patch a table element's originalXml (graphicFrame fragment), applying
 * the style edit. Returns the patched XML; the caller writes it back to
 * anchor.originalXml and sets dirty = true.
 */
function patchTableStyleXml(originalXml, edit) {
    let xml = originalXml;
    // ── 1. Replace <a:tblPr> ──────────────────────────────────────────
    if (edit.tblPrXml !== undefined) {
        // Whole-block replacement
        xml = replaceTblPr(xml, edit.tblPrXml);
    }
    else if (edit.firstRow !== undefined || edit.bandRow !== undefined) {
        // Change only the flags, keeping the rest (styleId etc.)
        const tblPrMatch = /<a:tblPr(\s[^>]*)?(\/?>)/s.exec(xml);
        if (tblPrMatch) {
            if (tblPrMatch[2] === '/>') {
                // Self-closing → expand, then change the flags
                let attrs = tblPrMatch[1] ?? '';
                if (edit.firstRow !== undefined)
                    attrs = setAttr(attrs, 'firstRow', edit.firstRow ? '1' : undefined);
                if (edit.bandRow !== undefined)
                    attrs = setAttr(attrs, 'bandRow', edit.bandRow ? '1' : undefined);
                // A closing </a:tblPr> for the self-closing form doesn't exist → only rewrite the open tag
                const newOpen = `<a:tblPr${attrs}>`;
                // Expand <a:tblPr.../> into <a:tblPr...></a:tblPr>
                xml =
                    xml.slice(0, tblPrMatch.index) +
                        newOpen +
                        '</a:tblPr>' +
                        xml.slice(tblPrMatch.index + tblPrMatch[0].length);
            }
            else {
                let attrs = tblPrMatch[1] ?? '';
                if (edit.firstRow !== undefined)
                    attrs = setAttr(attrs, 'firstRow', edit.firstRow ? '1' : undefined);
                if (edit.bandRow !== undefined)
                    attrs = setAttr(attrs, 'bandRow', edit.bandRow ? '1' : undefined);
                const newOpen = `<a:tblPr${attrs}>`;
                xml =
                    xml.slice(0, tblPrMatch.index) +
                        newOpen +
                        xml.slice(tblPrMatch.index + tblPrMatch[0].length);
            }
        }
    }
    // ── 2. Shading / borders: patch the targeted <a:tcPr> nodes ────────
    if (edit.shadingColor !== undefined ||
        edit.borderPreset !== undefined ||
        edit.clearDirectFormatting) {
        xml = edit.cells ? patchCellsTcPr(xml, edit) : patchAllTcPr(xml, edit);
    }
    return xml;
}
/** Replace <a:tblPr>…</a:tblPr> (or its self-closing form) in the XML with a new value. */
function replaceTblPr(xml, newTblPr) {
    // Self-closing
    const sc = /<a:tblPr[^>]*\/>/.exec(xml);
    if (sc)
        return xml.slice(0, sc.index) + newTblPr + xml.slice(sc.index + sc[0].length);
    // Open/close tag pair
    const open = xml.indexOf('<a:tblPr');
    if (open < 0) {
        // No tblPr: insert right after <a:tbl>
        const tbl = xml.indexOf('<a:tbl>');
        if (tbl >= 0)
            return xml.slice(0, tbl + '<a:tbl>'.length) + newTblPr + xml.slice(tbl + '<a:tbl>'.length);
        return xml;
    }
    const close = xml.indexOf('</a:tblPr>', open);
    if (close < 0)
        return xml;
    return xml.slice(0, open) + newTblPr + xml.slice(close + '</a:tblPr>'.length);
}
/** Set or remove key="value" in an XML attribute string (remove: value=undefined). */
function setAttr(attrs, key, value) {
    const re = new RegExp(`\\s${key}="[^"]*"`);
    const cleaned = attrs.replace(re, '');
    if (value === undefined)
        return cleaned;
    return `${cleaned} ${key}="${(0, xml_utils_1.escapeXmlAttr)(value)}"`;
}
/** Apply the shading/border/clear parts of an edit to one tcPr's children. */
function applyTcPrEdit(inner, edit) {
    if (edit.clearDirectFormatting) {
        inner = inner.replace(/<a:(solidFill|gradFill|pattFill|blipFill)>.*?<\/a:\1>/gs, '');
        inner = inner.replace(/<a:(noFill|grpFill)\/>/g, '');
        inner = inner.replace(/<a:(lnL|lnR|lnT|lnB|lnTlToBr|lnBlToTr)(\s[^>]*)?\/>/g, '');
        inner = inner.replace(/<a:(lnL|lnR|lnT|lnB|lnTlToBr|lnBlToTr)(\s[^>]*)?>.*?<\/a:\1>/gs, '');
    }
    // Remove existing fill nodes
    if (edit.shadingColor !== undefined) {
        inner = inner.replace(/<a:solidFill>.*?<\/a:solidFill>/gs, '');
        inner = inner.replace(/<a:noFill\/>/g, '');
        inner = inner.replace(/<a:noFill><\/a:noFill>/g, '');
        if (edit.shadingColor === 'none') {
            inner = '<a:noFill/>' + inner;
        }
        else if (edit.shadingColor) {
            const c = edit.shadingColor.replace('#', '').toUpperCase();
            inner = `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>` + inner;
        }
    }
    // Border handling
    if (edit.borderPreset !== undefined) {
        inner = inner.replace(/<a:lnL[^>]*>.*?<\/a:lnL>/gs, '');
        inner = inner.replace(/<a:lnR[^>]*>.*?<\/a:lnR>/gs, '');
        inner = inner.replace(/<a:lnT[^>]*>.*?<\/a:lnT>/gs, '');
        inner = inner.replace(/<a:lnB[^>]*>.*?<\/a:lnB>/gs, '');
        if (edit.borderPreset === 'all' && edit.borderColor) {
            const c = edit.borderColor.replace('#', '').toUpperCase();
            const w = edit.borderWidthEmu ?? 12700;
            const lnXml = (tag) => `<${tag} w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></${tag}>`;
            inner = inner + lnXml('a:lnL') + lnXml('a:lnR') + lnXml('a:lnT') + lnXml('a:lnB');
        }
        else if (edit.borderPreset === 'none') {
            inner =
                inner +
                    '<a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="0"><a:noFill/></a:lnB>';
        }
    }
    return inner;
}
/** Patch the fill/borders of every <a:tcPr> in the XML. */
function patchAllTcPr(xml, edit) {
    const out = [];
    let cursor = 0;
    const re = /<a:tcPr([^>]*)>(.*?)<\/a:tcPr>|<a:tcPr([^>]*)\/>/gs;
    let m;
    while ((m = re.exec(xml)) !== null) {
        out.push(xml.slice(cursor, m.index));
        // Existing children (non-self-closing form)
        const inner = applyTcPrEdit(m[2] ?? '', edit);
        const attrs = m[1] ?? m[3] ?? '';
        out.push(`<a:tcPr${attrs}>${inner}</a:tcPr>`);
        cursor = m.index + m[0].length;
    }
    out.push(xml.slice(cursor));
    return out.join('');
}
/** Span of the nth <tag> element in [from,to); only for tags that cannot nest (a:tr / a:tc). */
function nthSpan(xml, tag, n, from = 0, to = xml.length) {
    const re = new RegExp(`<${tag}[\\s>]`, 'g');
    re.lastIndex = from;
    let i = 0;
    let m;
    while ((m = re.exec(xml)) !== null && m.index < to) {
        if (i === n) {
            const close = xml.indexOf(`</${tag}>`, m.index);
            if (close < 0 || close + tag.length + 3 > to)
                return null;
            return { start: m.index, end: close + tag.length + 3 };
        }
        i++;
    }
    return null;
}
/** Patch the fill/borders of the <a:tcPr> of just the cells in edit.cells (creating a tcPr when a cell has none). */
function patchCellsTcPr(xml, edit) {
    // Back to front so earlier spans stay valid while splicing
    const cells = [...edit.cells].sort((a, b) => b.row - a.row || b.col - a.col);
    for (const { row, col } of cells) {
        if (row < 0 || col < 0)
            continue;
        const tr = nthSpan(xml, 'a:tr', row);
        if (!tr)
            continue;
        const tc = nthSpan(xml, 'a:tc', col, tr.start, tr.end);
        if (!tc)
            continue;
        let tcXml = xml.slice(tc.start, tc.end);
        const m = /<a:tcPr([^>]*)>(.*?)<\/a:tcPr>|<a:tcPr([^>]*)\/>/s.exec(tcXml);
        if (m) {
            const inner = applyTcPrEdit(m[2] ?? '', edit);
            const attrs = m[1] ?? m[3] ?? '';
            tcXml =
                tcXml.slice(0, m.index) +
                    `<a:tcPr${attrs}>${inner}</a:tcPr>` +
                    tcXml.slice(m.index + m[0].length);
        }
        else {
            // tcPr follows txBody in CT_TableCell
            tcXml = tcXml.replace(/<\/a:tc>$/, `<a:tcPr>${applyTcPrEdit('', edit)}</a:tcPr></a:tc>`);
        }
        xml = xml.slice(0, tc.start) + tcXml + xml.slice(tc.end);
    }
    return xml;
}
/** Find the table element with the given sourceId in the slide; returns its anchor.originalXml location. */
function findTableElementInSlide(slide, sourceId) {
    for (const el of slide.elements) {
        if (el.id === sourceId && el.type === 'table') {
            return el;
        }
    }
    return null;
}
