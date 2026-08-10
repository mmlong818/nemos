"use strict";
/// Full-page background normalization. The cloud html→pptx converter encodes the
/// page background as ordinary bottom-of-z-order full-page shapes when its own
/// promotion heuristics miss (e.g. a 1px fully-transparent border on the
/// container). Such shapes swallow every click/marquee on the slide, so:
/// - promoteSlideBackground rewrites them into a native <p:bg> at landing time
///   (strict conditions, destructive);
/// - isBackgroundLikeElement is the loose predicate the render layer uses to mark
///   surviving full-page backgrounds (existing files, image backgrounds) as
///   interaction-layer background nodes (non-destructive).
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteSlideBackground = promoteSlideBackground;
exports.isBackgroundLikeElement = isBackgroundLikeElement;
const generate_1 = require("./generate");
const animation_1 = require("./animation");
const EMU_PER_PX = 9525;
const COVER_TOL = 2 * EMU_PER_PX;
function coversPage(t, size, maxAreaRatio) {
    const o = t.offset;
    return (o.x <= COVER_TOL &&
        o.y <= COVER_TOL &&
        o.x + o.cx >= size.cx - COVER_TOL &&
        o.y + o.cy >= size.cy - COVER_TOL &&
        o.cx * o.cy <= size.cx * size.cy * maxAreaRatio);
}
function isOpaqueColor(c) {
    return /^#?[0-9a-fA-F]{6}$/.test(c) || /^#?[0-9a-fA-F]{6}[fF]{2}$/.test(c);
}
/** No stroke, zero width, or a fully transparent stroke color (#RRGGBB00). */
function strokeInvisible(stroke) {
    if (!stroke || stroke.width === 0 || stroke.fill.type === 'none')
        return true;
    return (stroke.fill.type === 'solid' &&
        (stroke.fill.color === 'none' || /^#?[0-9a-fA-F]{6}00$/.test(stroke.fill.color)));
}
function hasVisibleText(el) {
    return !!el.text?.paragraphs.some((p) => p.runs.some((r) => r.text.trim() !== ''));
}
/**
 * Strict predicate for the destructive rewrite: an unrotated, unflipped,
 * non-placeholder full-page rect with an opaque solid fill, invisible stroke, no
 * effects and no text — nothing is lost by replacing it with <p:bg>.
 */
function isPromotableBackgroundShape(el, size) {
    if (el.type !== 'shape' && el.type !== 'text')
        return false;
    const t = el;
    const tr = el.transform;
    return (!el.placeholder &&
        tr.rot === 0 &&
        !tr.flipH &&
        !tr.flipV &&
        coversPage(tr, size, 1.05) &&
        (t.presetGeometry ?? 'rect') === 'rect' &&
        !t.customGeometry &&
        t.fill?.type === 'solid' &&
        isOpaqueColor(t.fill.color) &&
        strokeInvisible(t.stroke) &&
        !t.shadow &&
        !t.glow &&
        !hasVisibleText(t));
}
/** Animations target shapes by cNvPr id; a referenced shape must not be deleted. */
function isReferencedByTiming(slide, el) {
    const id = (0, animation_1.elementSpid)(el);
    if (id == null)
        return true;
    const ref = `spid="${id}"`;
    return slide.bodySuffix.includes(ref) || slide.bodyPrefix.includes(ref);
}
/**
 * Promote the bottom-of-z-order contiguous run of full-page opaque solid shapes
 * into a native <p:bg> (topmost color wins — it is the one visible) and delete
 * them. Returns whether anything was promoted; on success the slide is
 * structureDirty and its model background is updated.
 */
function promoteSlideBackground(slide, size) {
    const leading = [];
    for (const el of slide.elements) {
        if (!isPromotableBackgroundShape(el, size) || isReferencedByTiming(slide, el))
            break;
        leading.push(el);
    }
    if (leading.length === 0)
        return false;
    const fill = leading[leading.length - 1].fill;
    if (fill?.type !== 'solid')
        return false;
    slide.elements.splice(0, leading.length);
    slide.bodyPrefix = (0, generate_1.patchSlideBackgroundXml)(slide.bodyPrefix, fill.color);
    slide.background = { type: 'solid', color: fill.color };
    slide.structureDirty = true;
    return true;
}
/**
 * Loose predicate for interaction-layer marking: a full-page unrotated textless
 * fill (solid/gradient/image shape, or a picture) with an invisible stroke.
 * Marked nodes stay visible and editable but stop swallowing marquee drags.
 */
function isBackgroundLikeElement(el, size) {
    if (el.placeholder || el.transform.rot !== 0)
        return false;
    if (!coversPage(el.transform, size, 1.5))
        return false;
    if (el.type === 'picture') {
        const p = el;
        return !p.media && strokeInvisible(p.stroke);
    }
    if (el.type !== 'shape' && el.type !== 'text')
        return false;
    const t = el;
    const fillKind = t.fill?.type;
    return ((fillKind === 'solid' || fillKind === 'gradient' || fillKind === 'image') &&
        (t.presetGeometry ?? 'rect') === 'rect' &&
        !t.customGeometry &&
        strokeInvisible(t.stroke) &&
        !hasVisibleText(t));
}
