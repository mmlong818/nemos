"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMasterParts = listMasterParts;
exports.parseMasterPart = parseMasterPart;
const zip_1 = require("./zip");
const theme_1 = require("./theme");
const parse_1 = require("./parse");
const placeholder_1 = require("./placeholder");
const partNum = (p) => parseInt(/(\d+)\.xml$/.exec(p)?.[1] ?? '0', 10);
function cSldName(xml, fallback) {
    const m = xml ? /<p:cSld\s[^>]*name="([^"]*)"/.exec(xml) : null;
    return m?.[1] || fallback;
}
/** Enumerate parts for the master edit view: each master first, followed by its layouts. */
function listMasterParts(archive) {
    const masters = [...archive.entries.keys()]
        .filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
        .sort((a, b) => partNum(a) - partNum(b));
    const out = [];
    for (const m of masters) {
        out.push({ partPath: m, kind: 'master', name: cSldName(archive.readText(m), baseName(m)) });
        const layouts = [...archive.readRels(m).values()]
            .filter((r) => r.type.endsWith('/slideLayout'))
            .map((r) => (0, zip_1.resolveTarget)(m, r.target))
            .sort((a, b) => partNum(a) - partNum(b));
        for (const l of layouts) {
            out.push({ partPath: l, kind: 'layout', name: cSldName(archive.readText(l), baseName(l)) });
        }
    }
    return out;
}
function baseName(p) {
    return p.slice(p.lastIndexOf('/') + 1, -4);
}
/** A part's own image rels (same logic as index.ts partMediaRels, duplicated to avoid a circular dependency). */
function partMedia(archive, partPath) {
    const media = new Map();
    for (const rel of archive.readRels(partPath).values()) {
        if (rel.type.endsWith('/image'))
            media.set(rel.id, (0, zip_1.resolveTarget)(partPath, rel.target));
    }
    return media;
}
/**
 * Parse a layout/master part into an editable Slide (its spTree structure is isomorphic
 * to a slide's, so scanSlide applies directly).
 * - master: text styles come from its own <p:txStyles>; placeholders always have an
 *   explicit xfrm, so no geometry inheritance is needed.
 * - layout: placeholder geometry/text styles/background inherit from its master; the
 *   master decoration layer is rendered underneath.
 */
function parseMasterPart(archive, partPath) {
    const xml = archive.readText(partPath);
    if (!xml)
        return null;
    const isMaster = partPath.includes('/slideMasters/');
    let masterPath = isMaster ? partPath : undefined;
    if (!isMaster) {
        for (const rel of archive.readRels(partPath).values()) {
            if (rel.type.endsWith('/slideMaster')) {
                masterPath = (0, zip_1.resolveTarget)(partPath, rel.target);
                break;
            }
        }
    }
    const ctx = {};
    if (masterPath) {
        for (const rel of archive.readRels(masterPath).values()) {
            if (rel.type.endsWith('/theme')) {
                const themeXml = archive.readText((0, zip_1.resolveTarget)(masterPath, rel.target));
                if (themeXml)
                    ctx.theme = (0, theme_1.parseTheme)(themeXml);
                break;
            }
        }
    }
    ctx.mediaRels = partMedia(archive, partPath);
    ctx.tableStyles = archive.readText('ppt/tableStyles.xml') ?? undefined;
    const masterXml = !isMaster && masterPath ? archive.readText(masterPath) : undefined;
    if (isMaster) {
        ctx.masterTextStyles = (0, placeholder_1.parseMasterTextStyles)(xml, ctx.theme);
    }
    else if (masterXml) {
        ctx.masterPlaceholders = (0, placeholder_1.parsePlaceholderMap)(masterXml, ctx.theme);
        ctx.masterTextStyles = (0, placeholder_1.parseMasterTextStyles)(masterXml, ctx.theme);
        ctx.masterBg = masterXml;
    }
    const slide = (0, parse_1.parseSlide)({ path: partPath, slideXml: xml, masterPath, ctx });
    // Layout view renders master concrete shapes underneath (master decorations stay visible when editing a layout)
    if (!isMaster && masterXml && masterPath) {
        if (!/<p:sldLayout\b[^>]*showMasterSp="(?:0|false)"/.test(xml)) {
            const dctx = { theme: ctx.theme, mediaRels: partMedia(archive, masterPath) };
            const dec = (0, parse_1.parseDecorations)(masterXml, dctx, {});
            if (dec.length)
                slide.decorations = dec;
        }
    }
    return slide;
}
