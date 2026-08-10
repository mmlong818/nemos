"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_LAYOUTS = exports.BUILTIN_LAYOUT_PREFIX = void 0;
exports.shouldOfferBuiltinLayouts = shouldOfferBuiltinLayouts;
exports.builtinLayoutInfos = builtinLayoutInfos;
exports.ensureBuiltinLayout = ensureBuiltinLayout;
const zip_1 = require("./zip");
const layout_1 = require("./layout");
const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const MASTER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';
const LAYOUT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
/** Virtual layout-path prefix offered by the UI before the layout exists in the package */
exports.BUILTIN_LAYOUT_PREFIX = 'builtin:';
const BASE_CX = 12192000;
const BASE_CY = 6858000;
const TITLE = { type: 'title', x: 838200, y: 365125, cx: 10515600, cy: 1325563 };
const BODY = { type: 'body', idx: '1', x: 838200, y: 1825625, cx: 10515600, cy: 4351338 };
exports.BUILTIN_LAYOUTS = [
    {
        key: 'titleSlide',
        name: 'Title Slide',
        type: 'title',
        placeholders: [
            { type: 'ctrTitle', x: 1524000, y: 1122363, cx: 9144000, cy: 2387600 },
            { type: 'subTitle', idx: '1', x: 1524000, y: 3602038, cx: 9144000, cy: 1655762 },
        ],
    },
    { key: 'titleContent', name: 'Title and Content', type: 'obj', placeholders: [TITLE, BODY] },
    {
        key: 'sectionHeader',
        name: 'Section Header',
        type: 'secHead',
        placeholders: [
            { type: 'title', x: 831850, y: 4589463, cx: 10515600, cy: 1500187 },
            { type: 'body', idx: '1', x: 831850, y: 1709738, cx: 10515600, cy: 2852737 },
        ],
    },
    {
        key: 'twoContent',
        name: 'Two Content',
        type: 'twoObj',
        placeholders: [
            TITLE,
            { type: 'body', idx: '1', x: 838200, y: 1825625, cx: 5157787, cy: 4351338 },
            { type: 'body', idx: '2', x: 6172200, y: 1825625, cx: 5181600, cy: 4351338 },
        ],
    },
    { key: 'titleOnly', name: 'Title Only', type: 'titleOnly', placeholders: [TITLE] },
    { key: 'blank', name: 'Blank', type: 'blank', placeholders: [] },
];
function scalePh(ph, size) {
    const sx = (v) => Math.round((v / BASE_CX) * size.cx);
    const sy = (v) => Math.round((v / BASE_CY) * size.cy);
    return {
        type: ph.type,
        idx: ph.idx ?? '',
        x: sx(ph.x),
        y: sy(ph.y),
        cx: sx(ph.cx),
        cy: sy(ph.cy),
        hint: layout_1.PH_HINT_MAP[ph.type] ?? 'Click to add text',
    };
}
/**
 * Whether the picker should offer the built-in set: true while no foreign
 * (non-built-in-named) layout carries placeholders. Judging by name keeps
 * already-injected built-ins from turning the offer off — otherwise the rest
 * of the standard set would vanish after the first one is used.
 */
function shouldOfferBuiltinLayouts(layouts) {
    const names = new Set(exports.BUILTIN_LAYOUTS.map((d) => d.name));
    return !layouts.some((l) => l.placeholders.length && !names.has(l.name));
}
/**
 * Virtual SlideLayoutInfo entries for the layout picker (path = 'builtin:<key>').
 * Definitions whose canonical name collides with an existing layout are skipped.
 */
function builtinLayoutInfos(size, existingNames) {
    return exports.BUILTIN_LAYOUTS.filter((d) => !existingNames.has(d.name)).map((d) => ({
        path: `${exports.BUILTIN_LAYOUT_PREFIX}${d.key}`,
        name: d.name,
        layoutType: d.type,
        placeholders: d.placeholders.map((ph) => scalePh(ph, size)),
    }));
}
const EMPTY_SPTREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
function buildLayoutXml(def, size) {
    const shapes = def.placeholders.map((ph, i) => (0, layout_1.placeholderSpXml)(scalePh(ph, size), i + 2));
    return (XMLDECL +
        `<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="${def.type}">` +
        `<p:cSld name="${def.name}"><p:spTree>${EMPTY_SPTREE}${shapes.join('')}</p:spTree></p:cSld>` +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
}
/** The slideMaster the deck's layouts hang off (via any layout's rels, else the first master part). */
function findMasterPath(archive) {
    for (const path of archive.entries.keys()) {
        if (!/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path))
            continue;
        for (const rel of archive.readRels(path).values()) {
            if (rel.type === MASTER_REL_TYPE)
                return (0, zip_1.resolveTarget)(path, rel.target);
        }
    }
    const masters = [...archive.entries.keys()]
        .filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
        .sort();
    return masters[0] ?? null;
}
/**
 * Make sure a built-in layout exists in the package and return its path.
 * Idempotent: an existing layout with the same canonical name is reused.
 * Returns null for an unknown key or a package without a slideMaster.
 */
function ensureBuiltinLayout(archive, size, key) {
    const def = exports.BUILTIN_LAYOUTS.find((d) => d.key === key);
    if (!def)
        return null;
    const existing = (0, layout_1.listSlideLayouts)(archive).find((l) => l.name === def.name);
    if (existing)
        return existing.path;
    const masterPath = findMasterPath(archive);
    if (!masterPath)
        return null;
    const masterXml = archive.readText(masterPath);
    const masterRelsPath = (0, zip_1.relsPathFor)(masterPath);
    const masterRels = archive.readText(masterRelsPath);
    if (!masterXml || !masterRels)
        return null;
    let maxLayout = 0;
    for (const p of archive.entries.keys()) {
        const m = /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/.exec(p);
        if (m)
            maxLayout = Math.max(maxLayout, parseInt(m[1], 10));
    }
    const layoutPath = `ppt/slideLayouts/slideLayout${maxLayout + 1}.xml`;
    archive.entries.set(layoutPath, Buffer.from(buildLayoutXml(def, size), 'utf8'));
    const layoutRels = XMLDECL +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${MASTER_REL_TYPE}" Target="../slideMasters/${masterPath.slice('ppt/slideMasters/'.length)}"/>` +
        '</Relationships>';
    archive.entries.set((0, zip_1.relsPathFor)(layoutPath), Buffer.from(layoutRels, 'utf8'));
    const ctPath = '[Content_Types].xml';
    const ct = archive.readText(ctPath);
    if (ct && !ct.includes(`PartName="/${layoutPath}"`)) {
        archive.entries.set(ctPath, Buffer.from(ct.replace('</Types>', `<Override PartName="/${layoutPath}" ContentType="${LAYOUT_CONTENT_TYPE}"/></Types>`), 'utf8'));
    }
    let maxRid = 0;
    for (const m of masterRels.matchAll(/Id="rId(\d+)"/g))
        maxRid = Math.max(maxRid, Number(m[1]));
    const rid = `rId${maxRid + 1}`;
    archive.entries.set(masterRelsPath, Buffer.from(masterRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${layout_1.LAYOUT_REL_TYPE}" Target="../slideLayouts/${layoutPath.slice('ppt/slideLayouts/'.length)}"/></Relationships>`), 'utf8'));
    // sldLayoutId ids live in the ≥2147483648 range per spec
    let maxId = 2147483648;
    for (const m of masterXml.matchAll(/<p:sldLayoutId\s[^>]*\bid="(\d+)"/g))
        maxId = Math.max(maxId, Number(m[1]));
    const idTag = `<p:sldLayoutId id="${maxId + 1}" r:id="${rid}"/>`;
    const nextMaster = masterXml.includes('</p:sldLayoutIdLst>')
        ? masterXml.replace('</p:sldLayoutIdLst>', `${idTag}</p:sldLayoutIdLst>`)
        : masterXml.replace(/(<p:clrMap\b[^>]*\/>)/, `$1<p:sldLayoutIdLst>${idTag}</p:sldLayoutIdLst>`);
    archive.entries.set(masterPath, Buffer.from(nextMaster, 'utf8'));
    return layoutPath;
}
