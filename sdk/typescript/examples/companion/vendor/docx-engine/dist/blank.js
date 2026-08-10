"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLANK_NUMBERING_XML = exports.BLANK_ORDERED_NUM_ID = exports.BLANK_BULLET_NUM_ID = void 0;
exports.abstractNumXml = abstractNumXml;
exports.buildBlankDocx = buildBlankDocx;
const jszip_1 = __importDefault(require("jszip"));
/**
 * Blank document template for "new document" and AI from-scratch generation.
 *
 * The generate layer only references styles / numbering that already exist in
 * the package, so a fresh document must ship with the standard set: Normal,
 * Heading1-6, ListParagraph, Hyperlink, TOC1-9 (for generated TOC fields),
 * plus bullet (numId 1) and decimal (numId 2) numbering definitions.
 */
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
/** numId of the template's bullet list definition */
exports.BLANK_BULLET_NUM_ID = '1';
/** numId of the template's ordered (decimal) list definition */
exports.BLANK_ORDERED_NUM_ID = '2';
/** TOC entry styles referenced by generateTocFieldXml (indent grows per level) */
function tocStyle(level) {
    const ind = level > 1 ? `<w:ind w:left="${220 * (level - 1)}"/>` : '';
    return (`<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/>` +
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
        `<w:pPr><w:spacing w:after="100"/>${ind}</w:pPr></w:style>`);
}
function headingStyle(level, sizeHalfPoints) {
    return (`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        `<w:pPr><w:keepNext/><w:spacing w:before="${level <= 2 ? 240 : 160}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${sizeHalfPoints}"/><w:szCs w:val="${sizeHalfPoints}"/></w:rPr></w:style>`);
}
const stylesXml = (eastAsiaFont) => XML_DECL +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="Calibri"${eastAsiaFont ? ` w:eastAsia="${eastAsiaFont}"` : ''} w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    headingStyle(1, 32) +
    headingStyle(2, 28) +
    headingStyle(3, 26) +
    headingStyle(4, 24) +
    headingStyle(5, 22) +
    headingStyle(6, 22) +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    Array.from({ length: 9 }, (_, i) => tocStyle(i + 1)).join('') +
    '</w:styles>';
function bulletLevels() {
    let xml = '';
    for (let ilvl = 0; ilvl < 5; ilvl++) {
        xml +=
            `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/>` +
                `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr>` +
                '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>';
    }
    return xml;
}
function decimalLevels() {
    let xml = '';
    for (let ilvl = 0; ilvl < 5; ilvl++) {
        xml +=
            `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${ilvl + 1}."/>` +
                `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
    return xml;
}
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function customLevels(levels) {
    return levels
        .map((l, ilvl) => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${l.start ?? 1}"/><w:numFmt w:val="${escAttr(l.numFmt)}"/>` +
        `<w:lvlText w:val="${escAttr(l.lvlText)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${Math.round(l.indentLeft)}" w:hanging="${Math.round(l.hanging ?? 360)}"/></w:pPr></w:lvl>`)
        .join('');
}
/** One abstractNum definition; uses custom levels when provided, otherwise the blank-template style (5 levels) */
function abstractNumXml(abstractNumId, kind, levels) {
    const body = levels?.length
        ? customLevels(levels)
        : kind === 'bullet'
            ? bulletLevels()
            : decimalLevels();
    return `<w:abstractNum w:abstractNumId="${abstractNumId}">${body}</w:abstractNum>`;
}
/** The blank template's numbering.xml (bullet numId 1 / decimal numId 2);
 *  base content used when the document has no such part */
exports.BLANK_NUMBERING_XML = XML_DECL +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:abstractNum w:abstractNumId="0">${bulletLevels()}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1">${decimalLevels()}</w:abstractNum>` +
    `<w:num w:numId="${exports.BLANK_BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="${exports.BLANK_ORDERED_NUM_ID}"><w:abstractNumId w:val="1"/></w:num>` +
    '</w:numbering>';
const NUMBERING_XML = exports.BLANK_NUMBERING_XML;
/** Build a minimal valid .docx: one empty paragraph, A4 portrait, standard styles. */
async function buildBlankDocx(options) {
    const zip = new jszip_1.default();
    zip.file('[Content_Types].xml', `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '</Types>');
    zip.file('_rels/.rels', `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>');
    zip.file('word/_rels/document.xml.rels', `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
        '</Relationships>');
    zip.file('word/styles.xml', stylesXml(options?.eastAsiaFont));
    zip.file('word/numbering.xml', NUMBERING_XML);
    const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
        '</w:sectPr>';
    zip.file('word/document.xml', `${XML_DECL}<w:document ${DOC_NS}><w:body><w:p/>${sectPr}</w:body></w:document>`);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
