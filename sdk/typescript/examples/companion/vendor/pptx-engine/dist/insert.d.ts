/**
 * Element insertion — synthesizes a raw <p:sp> fragment and hangs it on
 * slide.elements.
 *
 * Naturally compatible with patch-based saving: a new element's
 * anchor.originalXml is the generated XML, which patchSlideXml includes when
 * splicing elements together; deletion is removal from the array.
 * Both change the spTree structure, driving a full-slide rebuild via
 * slide.structureDirty.
 */
import type { EmuRect, Paragraph, PictureElement, Slide, SlideElement, TextElement } from './types';
import type { OpenedPptx } from './index';
/**
 * 'textbox' is a special value (plain text box without prstGeom); anything else is
 * an OOXML preset geometry name (rect/roundRect/ellipse/triangle/star5/rightArrow/
 * chevron…). Presets whose polygon approximation the render layer hasn't
 * implemented fall back to a rectangle; always correct in PowerPoint.
 */
export type NewShapeKind = 'textbox' | (string & {});
export interface NewElementOptions {
    kind: NewShapeKind;
    offset: EmuRect;
    paragraphs?: Paragraph[];
    /** Solid shape fill (#RRGGBB); textbox has no fill by default */
    fillColor?: string;
    /** Shape stroke (solid color, width in EMU) */
    stroke?: {
        color: string;
        widthEmu: number;
    };
}
export declare function isLineKind(kind: string): boolean;
/** Max cNvPr id used in the slide (including new elements); new elements take max+1 */
export declare function nextCNvPrId(slide: Slide): number;
export declare function buildSpXml(slide: Slide, opts: NewElementOptions): string;
/** Synthesize a new element and hang it on the slide; returns the model element (immediately usable by the render layer). */
export declare function addElement(slide: Slide, opts: NewElementOptions): TextElement;
export interface NewTableOptions {
    rows: number;
    cols: number;
    offset: EmuRect;
}
/**
 * Build the table graphicFrame fragment (equal-width columns / equal-height rows,
 * default built-in style, empty cells). Insertion goes through appendRawElements
 * (materialize+reparse), reusing the existing table parsing/rendering pipeline.
 */
export declare function buildTableXml(slide: Slide, opts: NewTableOptions): string;
export interface NewPictureOptions {
    /** Image bytes */
    bytes: Uint8Array;
    /** Lowercase extension (png/jpg/…) */
    ext: string;
    offset: EmuRect;
    /** cNvPr name (default Picture N; hand-drawn ink is marked with the aislides-ink prefix) */
    name?: string;
    /** cNvPr descr: editor-specific payload (e.g. ink vector points), recoverable on reopen */
    descr?: string;
}
/**
 * Insert a picture: media bytes into the package + [Content_Types] Default +
 * slide rels registration + synthesized <p:pic> fragment hung on slide.elements.
 * The dataUrl is generated on demand by the caller (media resolver).
 */
/**
 * Land an image into the package: media part + Content_Types Default + slide rels.
 * Returns the new relationship id and media path (shared by picture insertion /
 * shape picture fill).
 */
export declare function addImageMediaAndRel(opened: OpenedPptx, slide: Slide, bytes: Uint8Array, extRaw: string): {
    rid: string;
    mediaPath: string;
} | null;
export declare function addPicture(opened: OpenedPptx, slide: Slide, opts: NewPictureOptions): PictureElement | null;
/** Delete by element id; returns whether anything was removed. */
export declare function deleteElement(slide: Slide, elementId: string): boolean;
/**
 * Compute the bounding box of a set of elements (slide coordinates, EMU).
 * Ignores rotation: uses the axis-aligned bounding box of each element's offset
 * rect.
 */
export declare function calcBoundingBox(elements: SlideElement[]): EmuRect;
/**
 * Build the <p:grpSp> XML fragment.
 *
 * OOXML conventions (ECMA 376 §19.3.1.22):
 *  - grpSpPr/xfrm describes the group's position and size on the slide (<a:off>/<a:ext>)
 *  - grpSpPr/xfrm/chOff + chExt define the child coordinate system's origin and size
 *  - This implementation sets chOff == bbox.xy and chExt == bbox.cxcy, i.e. the child
 *    coordinate system is 1:1 with the slide's → child elements can reuse their
 *    original slide coordinates inside the group with no transform
 *  - childrenXml: concatenation of each child's raw XML fragment (passthrough
 *    children keep their original bytes)
 */
export declare function buildGrpSpXml(slide: Slide, bbox: EmuRect, childrenXml: string): string;
