/**
 * SlideLayout listing + inserting a new slide with a given layout.
 *
 * Read-only: layout parts are never written back.
 * Provides:
 *  - listSlideLayouts: enumerate every slideLayout's path/name/placeholders in the pptx
 *  - insertBlankSlideWithLayout: insert a blank slide after a given position, with
 *    rels pointing at the chosen layout
 */
import type { PackageArchive } from './zip';
import type { SlideDeck } from './types';
/** Summary of one placeholder (used to generate empty placeholder elements for new slides) */
export interface LayoutPlaceholder {
    /** ph type: 'title'|'ctrTitle'|'body'|'subTitle'|'obj'|'ftr'|'sldNum'|'dt'|'' */
    type: string;
    /** ph idx */
    idx: string;
    /** Geometry (EMU; read directly from the layout) */
    x: number;
    y: number;
    cx: number;
    cy: number;
    /** Editor default hint text (shown in the empty box) */
    hint: string;
}
/** Description of one slideLayout */
export interface SlideLayoutInfo {
    /** Path inside the zip, e.g. ppt/slideLayouts/slideLayout3.xml */
    path: string;
    /** Layout name (<p:cSld name="…">, falling back to the file name) */
    name: string;
    /** Layout type attribute (blank/title/titleBody/…; from <p:sldLayout type="…">) */
    layoutType: string;
    /** Main placeholders (excluding functional placeholders ftr/sldNum/dt/pic) */
    placeholders: LayoutPlaceholder[];
}
export declare const PH_HINT_MAP: Record<string, string>;
export declare const FUNCTION_TYPES: Set<string>;
/** Parse all placeholder geometry from the layout XML (only non-functional placeholders with an xfrm) */
export declare function parseLayoutPlaceholders(xml: string): LayoutPlaceholder[];
/**
 * Enumerate all slideLayouts in the archive (sorted by number).
 * Only scans ppt/slideLayouts/slideLayoutN.xml files; does not rely on
 * presentation.xml's sldLayoutIdLst.
 */
export declare function listSlideLayouts(archive: PackageArchive): SlideLayoutInfo[];
export declare const LAYOUT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
export interface InsertLayoutSlideOptions {
    /** Insert after this slide index (0-based) */
    sourceIndex: number;
    /** Target layout path (from listSlideLayouts), e.g. 'ppt/slideLayouts/slideLayout2.xml' */
    layoutPath: string;
}
/**
 * One empty placeholder shape (<p:sp>) slice: explicit xfrm + empty paragraph
 * (like a new PowerPoint slide; the click hint is drawn by the edit canvas, not persisted).
 */
export declare function placeholderSpXml(ph: Pick<LayoutPlaceholder, 'type' | 'idx' | 'x' | 'y' | 'cx' | 'cy'>, id: number): string;
/**
 * Insert a blank slide associated with a given layout.
 * The internal caller is responsible for:
 *  1. writing the new path into the archive
 *  2. registering it in presentation.xml + rels + [Content_Types].xml
 *  3. parsing and splicing it into deck.slides
 *
 * This function only performs the archive surgery of 1-3; parseSlide is up to the
 * caller (index.ts). Returns the new slide's path, or null on failure.
 */
export declare function prepareInsertSlideWithLayout(archive: PackageArchive, deck: SlideDeck, sourceIndex: number, layoutPath: string): string | null;
