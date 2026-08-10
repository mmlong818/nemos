"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_XML_REL_TYPE = exports.SOURCES_NS = void 0;
exports.findSourcesPart = findSourcesPart;
exports.parseSourcesXml = parseSourcesXml;
exports.buildSourcesXml = buildSourcesXml;
exports.buildSourcesItemPropsXml = buildSourcesItemPropsXml;
exports.citationText = citationText;
exports.bibliographyLine = bibliographyLine;
const xml_utils_1 = require("./xml-utils");
/**
 * Bibliography sources live in a customXml part using the Word b:Sources
 * schema, so sources added here appear in Word's own citation manager.
 */
exports.SOURCES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
exports.CUSTOM_XML_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
/** find the zip path of the existing b:Sources custom xml part, if any */
async function findSourcesPart(zip) {
    for (const name of Object.keys(zip.files)) {
        if (!/^customXml\/item\d+\.xml$/.test(name))
            continue;
        const xml = await zip.file(name).async('string');
        if (xml.includes('Sources') && xml.includes(exports.SOURCES_NS))
            return name;
    }
    return null;
}
function parseSourcesXml(xml) {
    const out = [];
    const re = /<b:Source>([\s\S]*?)<\/b:Source>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const body = m[1];
        const field = (tag) => {
            const f = new RegExp(`<b:${tag}>([\\s\\S]*?)</b:${tag}>`).exec(body)?.[1];
            return f ? decodeEntities(f.trim()) : undefined;
        };
        const tag = field('Tag');
        if (!tag)
            continue;
        // author: person name list (Last, First) or corporate name
        let author = field('Corporate') ?? '';
        if (!author) {
            const last = field('Last') ?? '';
            const first = field('First') ?? '';
            author = [last, first].filter(Boolean).join(', ');
        }
        out.push({
            tag,
            type: field('SourceType') ?? 'Misc',
            author,
            title: field('Title') ?? '',
            year: field('Year') ?? '',
            publisher: field('Publisher') ?? field('JournalName') ?? field('InternetSiteTitle'),
            url: field('URL'),
        });
    }
    return out;
}
function decodeEntities(text) {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
function sourceEntryXml(source) {
    const t = (tag, value) => value ? `<b:${tag}>${(0, xml_utils_1.escapeXmlText)(value)}</b:${tag}>` : '';
    // "Last, First" splits into Last/First; anything else is stored as Last
    const comma = source.author.indexOf(',');
    const last = comma === -1 ? source.author : source.author.slice(0, comma).trim();
    const first = comma === -1 ? '' : source.author.slice(comma + 1).trim();
    const authorXml = source.author
        ? '<b:Author><b:Author><b:NameList><b:Person>' +
            t('Last', last) +
            t('First', first) +
            '</b:Person></b:NameList></b:Author></b:Author>'
        : '';
    const publisherTag = source.type === 'JournalArticle'
        ? 'JournalName'
        : source.type === 'InternetSite'
            ? 'InternetSiteTitle'
            : 'Publisher';
    return ('<b:Source>' +
        t('Tag', source.tag) +
        t('SourceType', source.type) +
        authorXml +
        t('Title', source.title) +
        t('Year', source.year) +
        t(publisherTag, source.publisher) +
        t('URL', source.url) +
        '</b:Source>');
}
/**
 * Surgical rebuild of b:Sources: unchanged b:Source entries keep their original bytes
 * (unmodeled fields like Editor/Volume/Pages/DOI/multi-author lists are preserved), the
 * root element attributes (SelectedStyle citation style) come from the original document,
 * and only new/edited entries are rebuilt from the modeled fields.
 */
function buildSourcesXml(sources, originalXml = null) {
    const originals = new Map();
    let rootOpen = `<b:Sources SelectedStyle="\\APASixthEditionOfficeOnline.xsl" StyleName="APA" Version="6" xmlns:b="${exports.SOURCES_NS}" xmlns="${exports.SOURCES_NS}">`;
    if (originalXml) {
        const open = /<b:Sources(?:\s[^>]*)?>/.exec(originalXml)?.[0];
        if (open)
            rootOpen = open;
        for (const m of originalXml.match(/<b:Source>[\s\S]*?<\/b:Source>/g) ?? []) {
            const parsed = parseSourcesXml(m)[0];
            if (parsed)
                originals.set(parsed.tag, { xml: m, parsed });
        }
    }
    const unchanged = (a, b) => a.type === b.type && a.author === b.author && a.title === b.title && a.year === b.year &&
        (a.publisher ?? '') === (b.publisher ?? '') && (a.url ?? '') === (b.url ?? '');
    const body = sources
        .map((s) => {
        const orig = originals.get(s.tag);
        return orig && unchanged(orig.parsed, s) ? orig.xml : sourceEntryXml(s);
    })
        .join('');
    return rootOpen + body + '</b:Sources>';
}
function buildSourcesItemPropsXml() {
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<ds:datastoreItem ds:itemID="{4A8D2934-D5B1-4C15-A6F4-7A1B2C3D4E5F}"' +
        ' xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">' +
        `<ds:schemaRefs><ds:schemaRef ds:uri="${exports.SOURCES_NS}"/></ds:schemaRefs>` +
        '</ds:datastoreItem>');
}
/** in-text citation, e.g. "(Smith, 2024)" */
function citationText(source) {
    const author = source.author || source.title;
    return source.year ? `(${author}, ${source.year})` : `(${author})`;
}
/** one bibliography line in a simple APA-like format */
function bibliographyLine(source) {
    const parts = [];
    if (source.author)
        parts.push(source.author + '.');
    if (source.year)
        parts.push(`(${source.year}).`);
    if (source.title)
        parts.push(source.title + '.');
    if (source.publisher)
        parts.push(source.publisher + '.');
    if (source.url)
        parts.push(source.url);
    return parts.join(' ');
}
