/**
 * Theme application (Design tab theme gallery) — rewrites <a:clrScheme> and
 * <a:fontScheme> of every ppt/theme/theme*.xml in the package, in place.
 *
 * Semantics match PowerPoint: content referencing schemeClr / +mj-lt / +mn-lt
 * follows the new theme; content with explicit srgbClr / explicit fonts stays
 * as-is. After rewriting, the caller (main process) must save→reopen to reparse
 * the inheritance chain so elements' resolved colors/fonts refresh.
 *
 * Exception: theme parts are the sole exemption from the "never write back
 * layout/master/theme" rule — the whole point of the theme gallery is to replace
 * the theme; layout/master themselves are still untouched.
 */
import type { OpenedPptx } from './index';
/** One theme definition: 12 scheme colors + optional heading/body fonts. */
export interface ThemeSpec {
    name: string;
    /** dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink → #RRGGBB (upper or lower case) */
    colors: Record<string, string>;
    /** Heading (title) Latin font; original theme kept if unset */
    majorFont?: string;
    /** Body Latin font; original theme kept if unset */
    minorFont?: string;
}
/** Rewrite a theme XML's clrScheme/fontScheme; returned as-is if the scheme structure is missing. */
export declare function patchThemeXml(xml: string, spec: ThemeSpec): string;
/** Apply the theme to all theme parts in the package; returns the number rewritten. */
export declare function applyThemeToArchive(opened: OpenedPptx, spec: ThemeSpec): number;
/** Count explicit srgbClr colors in a batch of slide XML (uppercase hex → occurrence count). */
export declare function collectExplicitColors(xmls: string[]): Map<string, number>;
/**
 * Mapping table from explicit colors to new theme colors. Identity mappings are omitted.
 * Cluster assignment is deterministic: iterated by (occurrence count desc, hex asc).
 */
export declare function buildColorMap(counts: Map<string, number>, spec: ThemeSpec): Map<string, string>;
/** Recolor a slide XML per the mapping table (only <a:srgbClr val> touched). */
export declare function recolorXml(xml: string, map: Map<string, string>): string;
/**
 * Remap all slides' explicit colors onto the theme palette (rewriting archive
 * entries directly). Requires the model to have no unpersisted edits (caller should
 * save→reopen first), otherwise dirty elements would overwrite with old colors on
 * save. Returns the number of distinct colors mapped.
 */
export declare function remapDeckColors(opened: OpenedPptx, spec: ThemeSpec): number;
