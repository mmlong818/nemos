/**
 * Header/footer — "Apply to All" writes dt / ftr / sldNum placeholder
 * entities into each slide, one slide at a time.
 *
 * Simplification: placeholders carry an explicit xfrm (bottom left/center/right
 * segments) instead of relying on same-idx placeholder inheritance from the layout,
 * so they are visible with stable positions under any template.
 */
import type { Slide } from './types';
import { type OpenedPptx } from './index';
export interface HeaderFooterOptions {
    /** Footer text; null/undefined/'' = no footer */
    footer?: string | null;
    /** Whether to show the slide number */
    slideNum?: boolean;
    /** Date text (fixed text); null/'' = hidden. When auto=true, writes a dynamic datetime field */
    date?: string | null;
    /** Use a dynamic date field (auto-updates when opened in PowerPoint) */
    dateAuto?: boolean;
}
/**
 * Apply header/footer to the given slides (all slides by default).
 * Removes existing dt/ftr/sldNum placeholder elements first, then appends new
 * ones per the toggles. Returns whether any slide was modified.
 */
export declare function applyHeaderFooter(opened: OpenedPptx, opts: HeaderFooterOptions, slideIndexes?: number[]): boolean;
/** Read a slide's current footer state (for dialog echo-back). */
export declare function readHeaderFooter(slide: Slide): {
    footer: string | null;
    slideNum: boolean;
    date: string | null;
};
