"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageArchive = void 0;
exports.relsPathFor = relsPathFor;
exports.resolveTarget = resolveTarget;
/**
 * pptx package management — open the zip, archive the original by SHA-256, and read
 * parts and .rels.
 *
 * Byte fidelity: PackageArchive holds the original bytes of every entry; on save,
 * unmodified entries are written back byte-for-byte (handled by the patch layer).
 * This module only handles reading and metadata.
 */
const jszip_1 = __importDefault(require("jszip"));
const node_crypto_1 = require("node:crypto");
const fast_xml_parser_1 = require("fast-xml-parser");
const xml_utils_1 = require("./xml-utils");
const relsParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'Relationship' || name === 'sldId' || name === 'Override',
});
class PackageArchive {
    zip;
    entries;
    originalHash;
    constructor(zip, 
    /** Original bytes of every entry, keyed by path inside the zip */
    entries, originalHash) {
        this.zip = zip;
        this.entries = entries;
        this.originalHash = originalHash;
    }
    static async open(bytes) {
        const originalHash = (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
        const zip = await jszip_1.default.loadAsync(bytes);
        const entries = new Map();
        const names = Object.keys(zip.files);
        for (const name of names) {
            const file = zip.files[name];
            if (file.dir)
                continue;
            entries.set(name, await file.async('uint8array'));
        }
        return new PackageArchive(zip, entries, originalHash);
    }
    has(path) {
        return this.entries.has(path);
    }
    /** Read a part as a UTF-8 string (for XML parts). */
    readText(path) {
        const bytes = this.entries.get(path);
        if (!bytes)
            return null;
        return Buffer.from(bytes).toString('utf8');
    }
    readBytes(path) {
        return this.entries.get(path) ?? null;
    }
    /**
     * Read a part's relationships file. partPath e.g. 'ppt/slides/slide1.xml' →
     * 'ppt/slides/_rels/slide1.xml.rels'.
     */
    readRels(partPath) {
        const relsPath = relsPathFor(partPath);
        const rels = new Map();
        const xml = this.readText(relsPath);
        if (!xml)
            return rels;
        const doc = (0, xml_utils_1.asXmlNode)(relsParser.parse(xml));
        const list = (0, xml_utils_1.asXmlNode)(doc.Relationships).Relationship;
        for (const r of (0, xml_utils_1.xmlArray)(list)) {
            const id = String(r['@_Id'] ?? '');
            rels.set(id, {
                id,
                type: String(r['@_Type'] ?? ''),
                target: String(r['@_Target'] ?? ''),
                ...(r['@_TargetMode'] != null ? { targetMode: String(r['@_TargetMode']) } : {}),
            });
        }
        return rels;
    }
    /**
     * Read the presentation's slide size and the slide part paths in order.
     */
    readPresentation() {
        const presXml = this.readText('ppt/presentation.xml');
        if (!presXml)
            throw new Error('pptx: missing ppt/presentation.xml');
        const parser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            isArray: (name) => name === 'p:sldId',
        });
        const pres = (0, xml_utils_1.asXmlNode)(parser.parse(presXml));
        const rootRaw = pres['p:presentation'] ?? pres.presentation;
        if (!rootRaw)
            throw new Error('pptx: malformed presentation.xml');
        const root = (0, xml_utils_1.asXmlNode)(rootRaw);
        // Slide size
        const szRaw = root['p:sldSz'] ?? root.sldSz;
        const sz = szRaw ? (0, xml_utils_1.asXmlNode)(szRaw) : null;
        const size = {
            cx: sz ? parseInt(String(sz['@_cx']), 10) : 9144000,
            cy: sz ? parseInt(String(sz['@_cy']), 10) : 6858000,
        };
        // Slide order: presentation.xml.rels maps r:id to slide parts
        const rels = this.readRels('ppt/presentation.xml');
        const sldIdLst = (0, xml_utils_1.asXmlNode)(root['p:sldIdLst'] ?? root.sldIdLst);
        const slidePaths = [];
        for (const id of (0, xml_utils_1.xmlArray)(sldIdLst['p:sldId'])) {
            const rId = id['@_r:id'] ?? id['@_id'];
            if (!rId)
                continue;
            const rel = rels.get(String(rId));
            if (!rel)
                continue;
            slidePaths.push(resolveTarget('ppt/presentation.xml', rel.target));
        }
        return { size, slidePaths };
    }
    /** Resolve a slide's layout / master part paths (via the rels chain). */
    resolveSlideChain(slidePath) {
        const slideRels = this.readRels(slidePath);
        let layoutPath;
        for (const rel of slideRels.values()) {
            if (rel.type.endsWith('/slideLayout')) {
                layoutPath = resolveTarget(slidePath, rel.target);
                break;
            }
        }
        let masterPath;
        let themePath;
        if (layoutPath) {
            const layoutRels = this.readRels(layoutPath);
            for (const rel of layoutRels.values()) {
                if (rel.type.endsWith('/slideMaster')) {
                    masterPath = resolveTarget(layoutPath, rel.target);
                    break;
                }
            }
        }
        if (masterPath) {
            const masterRels = this.readRels(masterPath);
            for (const rel of masterRels.values()) {
                if (rel.type.endsWith('/theme')) {
                    themePath = resolveTarget(masterPath, rel.target);
                    break;
                }
            }
        }
        return { layoutPath, masterPath, themePath };
    }
}
exports.PackageArchive = PackageArchive;
/** 'ppt/slides/slide1.xml' → 'ppt/slides/_rels/slide1.xml.rels' */
function relsPathFor(partPath) {
    const idx = partPath.lastIndexOf('/');
    const dir = idx >= 0 ? partPath.slice(0, idx) : '';
    const file = idx >= 0 ? partPath.slice(idx + 1) : partPath;
    return `${dir ? dir + '/' : ''}_rels/${file}.rels`;
}
/**
 * Resolve a relative target into an absolute path inside the zip.
 * basePart is the referencing part's path (its directory is the base); target may be
 * something like '../slideLayouts/slideLayout1.xml'.
 */
function resolveTarget(basePart, target) {
    if (target.startsWith('/'))
        return target.slice(1);
    const baseDir = basePart.slice(0, basePart.lastIndexOf('/'));
    const parts = baseDir.split('/').filter(Boolean);
    for (const seg of target.split('/')) {
        if (seg === '.' || seg === '')
            continue;
        if (seg === '..')
            parts.pop();
        else
            parts.push(seg);
    }
    return parts.join('/');
}
