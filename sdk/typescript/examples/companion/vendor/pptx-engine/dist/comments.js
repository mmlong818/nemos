"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlideComments = getSlideComments;
exports.addSlideComment = addSlideComment;
exports.deleteSlideComment = deleteSlideComment;
const zip_1 = require("./zip");
const xml_utils_1 = require("./xml-utils");
const notes_1 = require("./notes");
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const COMMENTS_REL = `${REL_BASE}/comments`;
const AUTHORS_REL = `${REL_BASE}/commentAuthors`;
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml';
const AUTHORS_CT = 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml';
const AUTHORS_PATH = 'ppt/commentAuthors.xml';
function setEntry(archive, path, xml) {
    archive.entries.set(path, Buffer.from(xml, 'utf8'));
}
function addContentTypeOverride(archive, partPath, contentType) {
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (!ct || ct.includes(`PartName="/${partPath}"`))
        return;
    setEntry(archive, ctPath, ct.replace('</Types>', `<Override PartName="/${partPath}" ContentType="${contentType}"/></Types>`));
}
/** Author table: id → {name, initials}. */
function readAuthors(archive) {
    const map = new Map();
    const xml = archive.readText(AUTHORS_PATH);
    if (!xml)
        return map;
    for (const m of xml.matchAll(/<p:cmAuthor\b([^>]*)\/>/g)) {
        const attrs = m[1];
        const id = Number(/\bid="(\d+)"/.exec(attrs)?.[1] ?? -1);
        if (id < 0)
            continue;
        map.set(id, {
            name: (0, notes_1.unescapeXml)(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? ''),
            initials: (0, notes_1.unescapeXml)(/\binitials="([^"]*)"/.exec(attrs)?.[1] ?? ''),
        });
    }
    return map;
}
/** Path of a slide's comments part (null if the slide has no comments). */
function commentsPathForSlide(archive, slidePath) {
    for (const rel of archive.readRels(slidePath).values()) {
        if (rel.type === COMMENTS_REL)
            return (0, zip_1.resolveTarget)(slidePath, rel.target);
    }
    return null;
}
/** Read all comments on a slide (in order of appearance). */
function getSlideComments(archive, slidePath) {
    const partPath = commentsPathForSlide(archive, slidePath);
    if (!partPath)
        return [];
    const xml = archive.readText(partPath);
    if (!xml)
        return [];
    const authors = readAuthors(archive);
    const out = [];
    for (const m of xml.matchAll(/<p:cm\b([^>]*)>([\s\S]*?)<\/p:cm>/g)) {
        const attrs = m[1];
        const authorId = Number(/\bauthorId="(\d+)"/.exec(attrs)?.[1] ?? 0);
        const a = authors.get(authorId);
        out.push({
            authorId,
            author: a?.name ?? 'Unknown author',
            initials: a?.initials ?? '',
            dt: /\bdt="([^"]*)"/.exec(attrs)?.[1] ?? '',
            idx: Number(/\bidx="(\d+)"/.exec(attrs)?.[1] ?? 0),
            text: (0, notes_1.unescapeXml)(/<p:text>([\s\S]*?)<\/p:text>/.exec(m[2])?.[1] ?? ''),
        });
    }
    return out;
}
/**
 * Ensure the author exists and return {authorId, nextIdx} (bumping lastIdx).
 * Creates the author table / content type / presentation rel if missing.
 */
function ensureAuthor(archive, name, initials) {
    let xml = archive.readText(AUTHORS_PATH);
    if (!xml) {
        xml = XMLDECL + `<p:cmAuthorLst xmlns:p="${NS_P}"></p:cmAuthorLst>`;
        addContentTypeOverride(archive, AUTHORS_PATH, AUTHORS_CT);
        (0, notes_1.appendRelationship)(archive, 'ppt/presentation.xml', AUTHORS_REL, 'commentAuthors.xml');
    }
    // Existing author with the same name: reuse its id, lastIdx + 1
    for (const m of xml.matchAll(/<p:cmAuthor\b([^>]*)\/>/g)) {
        const attrs = m[1];
        if ((0, notes_1.unescapeXml)(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '') !== name)
            continue;
        const authorId = Number(/\bid="(\d+)"/.exec(attrs)?.[1] ?? 0);
        const lastIdx = Number(/\blastIdx="(\d+)"/.exec(attrs)?.[1] ?? 0);
        const nextIdx = lastIdx + 1;
        const bumped = m[0].includes('lastIdx="')
            ? m[0].replace(/\blastIdx="\d+"/, `lastIdx="${nextIdx}"`)
            : m[0].replace('/>', ` lastIdx="${nextIdx}"/>`);
        setEntry(archive, AUTHORS_PATH, xml.replace(m[0], bumped));
        return { authorId, nextIdx };
    }
    // New author
    let maxId = -1;
    for (const m of xml.matchAll(/<p:cmAuthor\b[^>]*\bid="(\d+)"/g))
        maxId = Math.max(maxId, Number(m[1]));
    const authorId = maxId + 1;
    const tag = `<p:cmAuthor id="${authorId}" name="${(0, xml_utils_1.escapeXmlAttr)(name)}"` +
        ` initials="${(0, xml_utils_1.escapeXmlAttr)(initials)}" lastIdx="1" clrIdx="${authorId}"/>`;
    setEntry(archive, AUTHORS_PATH, xml.replace('</p:cmAuthorLst>', `${tag}</p:cmAuthorLst>`));
    return { authorId, nextIdx: 1 };
}
/** Add a comment; returns the new comment (with assigned authorId/idx). */
function addSlideComment(opened, slideIndex, opts) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return null;
    const { archive } = opened;
    const initials = opts.initials ??
        opts.author
            .split(/\s+/)
            .map((w) => w[0] ?? '')
            .join('')
            .toUpperCase() ??
        '';
    const { authorId, nextIdx } = ensureAuthor(archive, opts.author, initials);
    let partPath = commentsPathForSlide(archive, slide.path);
    if (!partPath) {
        let maxNum = 0;
        for (const path of archive.entries.keys()) {
            const m = /^ppt\/comments\/comment(\d+)\.xml$/.exec(path);
            if (m)
                maxNum = Math.max(maxNum, Number(m[1]));
        }
        partPath = `ppt/comments/comment${maxNum + 1}.xml`;
        setEntry(archive, partPath, XMLDECL + `<p:cmLst xmlns:p="${NS_P}"></p:cmLst>`);
        addContentTypeOverride(archive, partPath, COMMENTS_CT);
        (0, notes_1.appendRelationship)(archive, slide.path, COMMENTS_REL, `../${partPath.slice(4)}`);
    }
    const xml = archive.readText(partPath);
    if (!xml)
        return null;
    const dt = new Date().toISOString();
    // Positions staggered along the top-left diagonal so comment badges don't overlap
    const count = [...xml.matchAll(/<p:cm\b/g)].length;
    const pos = 10 + (count % 8) * 6;
    const cm = `<p:cm authorId="${authorId}" dt="${dt}" idx="${nextIdx}">` +
        `<p:pos x="${pos}" y="${pos}"/>` +
        `<p:text>${(0, xml_utils_1.escapeXmlText)(opts.text)}</p:text></p:cm>`;
    setEntry(archive, partPath, xml.replace('</p:cmLst>', `${cm}</p:cmLst>`));
    return { authorId, author: opts.author, initials, dt, idx: nextIdx, text: opts.text };
}
/** Delete a comment (by authorId + idx). */
function deleteSlideComment(opened, slideIndex, ref) {
    const slide = opened.deck.slides[slideIndex];
    if (!slide)
        return false;
    const { archive } = opened;
    const partPath = commentsPathForSlide(archive, slide.path);
    if (!partPath)
        return false;
    const xml = archive.readText(partPath);
    if (!xml)
        return false;
    for (const m of xml.matchAll(/<p:cm\b([^>]*)>[\s\S]*?<\/p:cm>/g)) {
        const attrs = m[1];
        if (Number(/\bauthorId="(\d+)"/.exec(attrs)?.[1] ?? -1) === ref.authorId &&
            Number(/\bidx="(\d+)"/.exec(attrs)?.[1] ?? -1) === ref.idx) {
            setEntry(archive, partPath, xml.slice(0, m.index) + xml.slice(m.index + m[0].length));
            return true;
        }
    }
    return false;
}
