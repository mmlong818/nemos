/**
 * Phase 3.3 element-level patch generation — regenerating OOXML fragments for
 * dirty elements.
 *
 * Fidelity philosophy (aligned with docx-engine): **no wholesale parse→serialize**
 * (it loses unmodeled attributes: effects/custom geometry/extensions etc.).
 * Instead, **surgical in-place patches** of the original <p:sp> byte slice:
 *   - Text editing (the main scenario): replace each <a:r>'s <a:t> text content in
 *     order, and patch/inject <a:rPr> formatting attributes as needed
 *     (b/i/u/sz + solidFill color).
 *   - Untouched bytes (bodyPr/spPr/geometry/placeholder attributes…) are kept verbatim.
 *
 * If the model's run count doesn't match the original XML's <a:r> count (runs
 * added/removed / paragraph structure changed), fall back to the
 * "rebuild txBody per paragraph" path (still keeping outer bytes like spPr where
 * possible). The Phase 3 editor uses the former (lossless) when only text and
 * formatting change without structural edits; structural changes use the latter.
 */
import type { SlideElement, TextElement, Paragraph, Transform, PPrDirty } from './types';
/**
 * In-place patch of a text/shape element's original XML.
 * originalXml = the <p:sp>'s full original byte slice (anchor.originalXml).
 */
export declare function patchTextElementXml(el: TextElement, originalXml: string): string;
/**
 * Surgically patch the <a:pPr> of one <a:p>…</a:p> slice: only reorder groups we
 * model that are flagged dirty (lnSpc/spcBef/spcAft/bu*); non-dirty groups keep
 * their original bytes and join the reorder in schema order; unmodeled children
 * like defRPr/tabLst stay in place (schema order puts them after these groups, so
 * still valid). Attrs (algn/marL/indent) are set in place.
 */
export declare function patchParagraphPPrXml(paraXml: string, p: Paragraph, which: PPrDirty): string;
/**
 * Element-level paragraph formatting patch: surgically patch pPr per <a:p> (run
 * bytes untouched). Returns null when the paragraph count doesn't match the model
 * (the caller falls back to rebuild).
 */
export declare function patchElementPPr(el: TextElement, xml: string, which: PPrDirty): string | null;
/** Rebuild the <p:txBody>'s paragraph content on structural change, keeping the txBody wrapper and <a:bodyPr>. */
export declare function rebuildTxBody(el: TextElement, originalXml: string): string;
/**
 * Generate <a:p> from a model paragraph (for the rebuild path).
 * Paragraph properties write only explicit items (per the pPrExplicit flags; no
 * flags = a newly created element, all model values treated as explicit); display
 * values inherited from lstStyle/placeholder/master are not baked in — the rebuild
 * keeps lstStyle and placeholder attributes, so inheritance still resolves along
 * the original chain in PowerPoint.
 */
export declare function generateParagraphXml(p: Paragraph): string;
/** Gradient fill write-back parameters (subset of the model's Fill gradient). */
export interface GradientFillPatch {
    stops: Array<{
        pos: number;
        color: string;
    }>;
    /** 1/60000 degree (for linear) */
    angle?: number;
    /** Radial (circle path, center outward) */
    radial?: boolean;
}
type FillPatch = 'none' | string | GradientFillPatch | {
    rawFillXml: string;
};
/**
 * In-place patch of an element's shape fill (the fill node that is a direct child of spPr):
 * fill='none' -> <a:noFill/>; hex -> <a:solidFill>. When a direct fill child exists, patch
 * in place for the same kind and replace the whole block across kinds (never touching the
 * solidFill inside a:ln); otherwise insert after the geometry (prstGeom/custGeom) or xfrm.
 */
export declare function patchElementFill(originalXml: string, fill: FillPatch): string;
export interface StrokePatch {
    color: string;
    widthEmu: number;
    /** prstDash preset name; 'solid' removes the prstDash node; undefined keeps the original bytes */
    dash?: string;
}
/**
 * In-place patch of an element's stroke (the <a:ln> direct child of spPr):
 * stroke=null -> replace the fill child with <a:noFill/> (explicit no stroke, overriding
 * theme inheritance); otherwise change the w attribute and replace the fill child with a
 * solid color. With an existing a:ln only these spots are touched; other attributes
 * (cap/cmpd/algn) and children (headEnd/tailEnd/join) keep their original bytes; the
 * prstDash child is only rewritten when stroke.dash is set; without an a:ln, insert
 * after the fill/geometry.
 */
export declare function patchElementStroke(originalXml: string, stroke: StrokePatch | null): string;
/**
 * In-place patch of the <a:srcRect> inside a <p:pic>'s <p:blipFill>:
 * srcRect=null removes the srcRect (show the full image); otherwise writes the
 * l/t/r/b attributes (1/1000 %). Crop values are 0..1 fractions, converted to
 * OOXML's 0..100000 integers.
 */
export declare function patchPictureSrcRect(originalXml: string, srcRect: {
    l: number;
    t: number;
    r: number;
    b: number;
} | null): string;
/**
 * In-place patch of a slide's bodyPrefix: replace/inject the <p:bg> under <p:cSld>
 * with a solid color. Returns the new bodyPrefix (the caller writes it back to
 * slide.bodyPrefix and flags a rebuild).
 */
export declare function patchSlideBackgroundXml(bodyPrefix: string, color: string): string;
export type SlideTransitionKind = 'none' | 'morph' | 'fade' | 'push' | 'wipe' | 'split' | 'circle' | 'cover' | 'pull' | 'dissolve' | 'zoom' | 'random';
/**
 * In-place patch of the bodySuffix's <p:transition> (schema order: after clrMapOvr,
 * before timing). kind='none' only removes the effect; 'morph' writes an
 * AlternateContent-wrapped p159:morph. A configured auto-advance time (advTm) is
 * kept when switching effects. Returns
 * the new bodySuffix.
 */
export declare function patchSlideTransitionXml(bodySuffix: string, kind: SlideTransitionKind): string;
/** Read the current transition from the bodySuffix (for UI echo; unmodeled effects map to 'none'). */
export declare function readSlideTransitionXml(bodySuffix: string): SlideTransitionKind;
/**
 * In-place patch of the bodySuffix's auto-advance time (PowerPoint's "advance slide
 * after / rehearse timings"). ms=null removes it; when the slide has no transition,
 * a new empty <p:transition> carrying only advTm is created. Returns the new bodySuffix.
 */
export declare function patchSlideAdvanceTimeXml(bodySuffix: string, ms: number | null): string;
/** Read the auto-advance time from the bodySuffix (ms; null when unset). */
export declare function readSlideAdvanceTimeXml(bodySuffix: string): number | null;
/** In-place patch of the show attribute on the bodyPrefix root element; hidden=false removes it. Returns the new bodyPrefix. */
export declare function patchSlideHiddenXml(bodyPrefix: string, hidden: boolean): string;
/** Read whether the bodyPrefix marks the slide as hidden. */
export declare function readSlideHiddenXml(bodyPrefix: string): boolean;
export declare function generateXfrmXml(t: Transform, tag?: string): string;
/**
 * In-place patch of an element's xfrm (off/ext/rot/flip all taken from the model):
 * - sp/pic/grpSp: the first <a:xfrm> inside spPr/grpSpPr; when absent (placeholder
 *   inheriting geometry), inject a full <a:xfrm> after the spPr open tag.
 * - graphicFrame (table/chart/smartart/ole passthrough): <p:xfrm> (directly
 *   containing a:off/a:ext, required by the schema). Embedded content (OLE preview
 *   pictures etc.) may carry its own a:xfrm, so p:xfrm must be matched.
 *   Non-graphicFrame passthroughs have no p:xfrm and are returned unchanged.
 * - Existing xfrm: replace the whole block, but keep children other than off/ext
 *   (a group's chOff/chExt untouched).
 */
export declare function patchElementXfrm(el: SlideElement, originalXml: string): string;
/**
 * Write back <a:normAutofit>'s fontScale/lnSpcReduction (thousandths of a percent,
 * 62500 = 62.5%). Clears the attribute when the ratio ≈1 / no reduction
 * (defaults are not written). Only effective when bodyPr already has
 * normAutofit (elements with autofit=shrink always do).
 */
export declare function patchBodyPrAutofit(xml: string, fontScale: number, lnSpcReduction?: number): string;
export {};
