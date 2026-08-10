import type { Slide, SlideElement, SlideSize } from './types';
/**
 * Promote the bottom-of-z-order contiguous run of full-page opaque solid shapes
 * into a native <p:bg> (topmost color wins — it is the one visible) and delete
 * them. Returns whether anything was promoted; on success the slide is
 * structureDirty and its model background is updated.
 */
export declare function promoteSlideBackground(slide: Slide, size: SlideSize): boolean;
/**
 * Loose predicate for interaction-layer marking: a full-page unrotated textless
 * fill (solid/gradient/image shape, or a picture) with an invisible stroke.
 * Marked nodes stay visible and editable but stop swallowing marquee drags.
 */
export declare function isBackgroundLikeElement(el: SlideElement, size: SlideSize): boolean;
