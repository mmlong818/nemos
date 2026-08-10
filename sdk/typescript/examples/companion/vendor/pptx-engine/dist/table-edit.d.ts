/**
 * Table style editing — surgically patches <a:tblPr> style attributes
 * (firstRow/bandRow/tableStyleId) and each cell's <a:tcPr> fill/borders.
 *
 * Design philosophy: reuse the existing anchor.originalXml surgical-patch pattern,
 * replacing only the <a:tblPr> and <a:tcPr> nodes and keeping all other bytes
 * intact. Tables are "modeled" in this app (not passthrough), so editing is allowed.
 */
import type { Slide } from './types';
/** Table style edit parameters (engine side of the IPC EditTableStyleOp) */
export interface TableStyleEdit {
    /** Whole-block tblPr XML replacement applied directly (used for styleName presets) */
    tblPrXml?: string;
    /** Change only the firstRow flag */
    firstRow?: boolean;
    /** Change only the bandRow flag */
    bandRow?: boolean;
    /** Shading color #RRGGBB or 'none' (<a:solidFill> / <a:noFill> per tc) */
    shadingColor?: string | null;
    /** Border color + width (all = all borders; none = clear) */
    borderColor?: string | null;
    borderWidthEmu?: number | null;
    borderPreset?: 'all' | 'none' | null;
    /** Clear all tcPr direct fills/borders (what PowerPoint does when applying a gallery preset; otherwise direct cell formatting hides the style) */
    clearDirectFormatting?: boolean;
    /** Cells the shading/border edit applies to, as (row, tc index); undefined = whole table */
    cells?: Array<{
        row: number;
        col: number;
    }>;
}
export interface TableStylePreset {
    tblPrXml: string;
    description: string;
    /** Custom style: must first be ensured into ppt/tableStyles.xml */
    styleId?: string;
    styleDefXml?: string;
    /** Grid presets: add border lines to every cell directly (incl. outer frame; the style mechanism only covers inner lines) */
    border?: {
        color: string;
        widthEmu: number;
    };
}
/** The 8 preset styles (keys map to the ribbon style gallery). */
export declare const TABLE_STYLE_PRESETS: Record<string, TableStylePreset>;
/** Ensure the given style definition exists in tableStyles.xml; returned as-is if already present. */
export declare function ensureTableStyleXml(tableStylesXml: string | null | undefined, styleId: string, styleDefXml: string): string;
/**
 * Surgically patch a table element's originalXml (graphicFrame fragment), applying
 * the style edit. Returns the patched XML; the caller writes it back to
 * anchor.originalXml and sets dirty = true.
 */
export declare function patchTableStyleXml(originalXml: string, edit: TableStyleEdit): string;
/** Find the table element with the given sourceId in the slide; returns its anchor.originalXml location. */
export declare function findTableElementInSlide(slide: Slide, sourceId: string): import('./types').TableElement | null;
