"use strict";
/** XML escaping utilities (same as docx-engine's, used for patch generation). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.asXmlNode = asXmlNode;
exports.xmlArray = xmlArray;
exports.escapeXmlText = escapeXmlText;
exports.escapeXmlAttr = escapeXmlAttr;
/** View an unknown parse-tree value as an element node; non-objects read as empty. */
function asXmlNode(v) {
    return typeof v === 'object' && v !== null ? v : {};
}
/** Normalize fast-xml-parser's single-child collapse: always get an array of element nodes. */
function xmlArray(v) {
    if (Array.isArray(v))
        return v.map(asXmlNode);
    return v ? [asXmlNode(v)] : [];
}
function escapeXmlText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeXmlAttr(text) {
    return escapeXmlText(text).replace(/"/g, '&quot;');
}
