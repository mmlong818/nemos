import { type Theme } from './theme';
import { type PlaceholderMap, type MasterTextStyles } from './placeholder';
import type { Slide, SlideElement } from './types';
declare const EMU_PER_PT = 12700;
export interface ParseContext {
    theme?: Theme;
    /** Placeholder color for resolving style ref templates (value substituted for schemeClr val="phClr") */
    phClr?: string;
    /** Media rId → zip path, for picture parsing */
    mediaRels?: Map<string, string>;
    /** Hyperlink rId → resolved target: external url, or "slide:N" (0-based) for slide jumps */
    hlinkRels?: Map<string, string>;
    /** Chart rId → chartN.xml content (chart part referenced by a graphicFrame) */
    chartXmls?: Map<string, string>;
    /** Audio/video rId → media zip path or external URL (r:link of videoFile/audioFile) */
    avRels?: Map<string, {
        target: string;
        external?: boolean;
    }>;
    /** SmartArt: diagramData rId (dgm:relIds@r:dm) → prerendered drawing part content */
    diagramDrawings?: Map<string, string>;
    /** Placeholder geometry inheritance table: from the slideLayout (read-only) */
    layoutPlaceholders?: PlaceholderMap;
    /** Placeholder geometry inheritance table: from the slideMaster (read-only, fallback when the layout lacks it) */
    masterPlaceholders?: PlaceholderMap;
    /** master <p:txStyles> text style defaults (title/body/other families) */
    masterTextStyles?: MasterTextStyles;
    /** Full layout XML (read-only, for background inheritance) */
    layoutBg?: string;
    /** Full master XML (read-only, background inheritance fallback) */
    masterBg?: string;
    /** ppt/tableStyles.xml source (table style definitions, read-only) */
    tableStyles?: string;
}
export interface SlideParseInput {
    path: string;
    slideXml: string;
    layoutPath?: string;
    masterPath?: string;
    ctx: ParseContext;
}
export declare function parseSlide(input: SlideParseInput): Slide;
/** Direct child fragments of a p:grpSp in document order (depth-aware: nested groups stay one slice). */
export declare function sliceGroupChildXmls(grpXml: string): string[];
export interface DecorationOptions {
    /**
     * Footer-family placeholder types allowed to render (subset of ftr/sldNum/dt).
     * Such placeholders on the master show only when <p:hf> hasn't disabled them
     * and the slide has no placeholder of the same type.
     */
    hfTypes?: Set<string>;
    /** Actual value of the slide-number field <a:fld type="slidenum"> (replaces the cached text) */
    slideNum?: number;
}
/**
 * Parse decoration-layer elements from layout/master XML (read-only render, not saved):
 * - Non-placeholder concrete shapes (logos/color bars/decor images/connectors/groups) are all kept;
 * - Placeholders keep only the footer family specified by opts.hfTypes (ftr/sldNum/dt);
 *   the rest (title/body/pic etc. are content carriers, overridden by the slide) are skipped.
 */
export declare function parseDecorations(xml: string, ctx: ParseContext, opts?: DecorationOptions): SlideElement[];
export { EMU_PER_PT };
