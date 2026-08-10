"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSmartArtXml = buildSmartArtXml;
exports.addSmartArt = addSmartArt;
const xml_utils_1 = require("./xml-utils");
const index_1 = require("./index");
const insert_1 = require("./insert");
const smartart_layout_1 = require("./smartart-layout");
/** Fragment for a single child shape (in child coordinate space). */
function childSpXml(id, s) {
    const para = s.text
        ? `<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="${Math.round((s.fontSize ?? 14) * 100)}" b="1">` +
            '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>' +
            `<a:t>${(0, xml_utils_1.escapeXmlText)(s.text)}</a:t></a:r></a:p>`
        : '<a:p/>';
    return (`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${(0, xml_utils_1.escapeXmlAttr)(`SmartShape ${id}`)}"/>` +
        '<p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        `<p:spPr><a:xfrm><a:off x="${s.box.x}" y="${s.box.y}"/><a:ext cx="${s.box.cx}" cy="${s.box.cy}"/></a:xfrm>` +
        `<a:prstGeom prst="${s.prst}"><a:avLst/></a:prstGeom>` +
        `<a:solidFill><a:srgbClr val="${s.color}">` +
        (s.alpha != null && s.alpha < 1 ? `<a:alpha val="${Math.round(s.alpha * 100000)}"/>` : '') +
        '</a:srgbClr></a:solidFill></p:spPr>' +
        '<p:txBody><a:bodyPr wrap="square" anchor="ctr" rtlCol="0"><a:normAutofit/></a:bodyPr>' +
        `<a:lstStyle/>${para}</p:txBody></p:sp>`);
}
/** Build the grpSp group fragment. */
function buildSmartArtXml(slide, opts) {
    const baseId = (0, insert_1.nextCNvPrId)(slide);
    const o = opts.offset;
    const shapes = (0, smartart_layout_1.layoutShapes)(opts.layout, opts.items, o.cx, o.cy);
    const children = shapes.map((s, i) => childSpXml(baseId + 1 + i, s)).join('');
    return (`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${baseId}" name="SmartArt ${baseId}"/>` +
        '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        `<p:grpSpPr><a:xfrm><a:off x="${o.x}" y="${o.y}"/><a:ext cx="${o.cx}" cy="${o.cy}"/>` +
        `<a:chOff x="0" y="0"/><a:chExt cx="${o.cx}" cy="${o.cy}"/></a:xfrm></p:grpSpPr>` +
        `${children}</p:grpSp>`);
}
/** Insert SmartArt (shape-group version): append + reparse, returning the new slide and element id. */
function addSmartArt(opened, slideIndex, opts) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide || !opts.items.length)
        return null;
    const r = (0, index_1.appendRawElements)(opened, slideIndex, [buildSmartArtXml(slide, opts)]);
    return r ? { slide: r.slide, elementId: r.elementIds[r.elementIds.length - 1] } : null;
}
