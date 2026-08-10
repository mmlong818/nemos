"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xmlParser = void 0;
exports.nameOf = nameOf;
exports.childrenOf = childrenOf;
exports.attrsOf = attrsOf;
exports.textOf = textOf;
exports.findChild = findChild;
exports.findChildren = findChildren;
exports.childrenThroughSdt = childrenThroughSdt;
exports.boolProp = boolProp;
exports.underlineProp = underlineProp;
exports.serializeXNode = serializeXNode;
exports.escapeXmlText = escapeXmlText;
exports.escapeXmlAttr = escapeXmlAttr;
const fast_xml_parser_1 = require("fast-xml-parser");
exports.xmlParser = new fast_xml_parser_1.XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
});
function nameOf(node) {
    return Object.keys(node).find((k) => k !== ':@' && k !== '#text');
}
function childrenOf(node) {
    const name = nameOf(node);
    if (!name)
        return [];
    const value = node[name];
    return Array.isArray(value) ? value : [];
}
function attrsOf(node) {
    return node[':@'] ?? {};
}
function textOf(node) {
    let out = '';
    for (const child of childrenOf(node)) {
        if ('#text' in child)
            out += String(child['#text']);
        else
            out += textOf(child);
    }
    return out;
}
function findChild(node, name) {
    return childrenOf(node).find((c) => nameOf(c) === name);
}
function findChildren(node, name) {
    return childrenOf(node).filter((c) => nameOf(c) === name);
}
/**
 * Direct children with `name`, looking through w:sdt → w:sdtContent wrappers
 * (nested sdt included). Structured document tags may wrap table rows, cells
 * or paragraphs at any level; for display purposes the wrapper is transparent
 * (research-report templates wrap every field in an sdt).
 */
function childrenThroughSdt(node, name) {
    const names = Array.isArray(name) ? name : [name];
    const out = [];
    const visit = (n) => {
        for (const child of childrenOf(n)) {
            const cn = nameOf(child);
            if (cn !== undefined && names.includes(cn))
                out.push(child);
            else if (cn === 'w:sdt') {
                const content = findChild(child, 'w:sdtContent');
                if (content)
                    visit(content);
            }
        }
    };
    visit(node);
    return out;
}
/** OOXML boolean property: present => true unless w:val says otherwise */
function boolProp(parent, name) {
    const child = findChild(parent, name);
    if (!child)
        return false;
    const val = attrsOf(child)['w:val'];
    if (val === undefined)
        return true;
    return !['0', 'false', 'none', 'off'].includes(val.toLowerCase());
}
/**
 * w:u is NOT an OOXML boolean (CT_OnOff) — it is CT_Underline, where the
 * underline pattern lives entirely in w:val. A <w:u> with no w:val (e.g.
 * `<w:u w:color="415461"/>` as emitted by Pages/LibreOffice) means no
 * underline, matching how Word renders it.
 */
function underlineProp(parent) {
    const child = findChild(parent, 'w:u');
    if (!child)
        return false;
    const val = attrsOf(child)['w:val'];
    return val !== undefined && val !== 'none';
}
/**
 * XNode → XML text (attribute order = parse order, empty elements self-close). Semantic
 * fidelity, not byte fidelity: used to store parse-tree fragments (e.g. a run's rPr) as
 * writable source slices.
 */
function serializeXNode(node) {
    if ('#text' in node)
        return escapeXmlText(String(node['#text']));
    const name = nameOf(node);
    if (!name)
        return '';
    const attrs = Object.entries(attrsOf(node))
        .map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`)
        .join('');
    const inner = childrenOf(node).map(serializeXNode).join('');
    return inner === '' ? `<${name}${attrs}/>` : `<${name}${attrs}>${inner}</${name}>`;
}
// Control characters outside \t \n \r are illegal in XML 1.0 even when escaped
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
function escapeXmlText(text) {
    return text
        .replace(ILLEGAL_XML_CHARS, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function escapeXmlAttr(text) {
    return escapeXmlText(text).replace(/"/g, '&quot;');
}
