import { type Theme } from './theme';
import type { Fill, Stroke } from './types';
/** Style for one table region (whole table / banding / first row, etc.). */
export interface TablePartStyle {
    fill?: Fill;
    bold?: boolean;
    textColor?: string;
}
export interface TableStyleDef {
    wholeTbl?: TablePartStyle;
    band1H?: TablePartStyle;
    band2H?: TablePartStyle;
    band1V?: TablePartStyle;
    band2V?: TablePartStyle;
    firstRow?: TablePartStyle;
    lastRow?: TablePartStyle;
    firstCol?: TablePartStyle;
    lastCol?: TablePartStyle;
    /** Inner separator lines between cells (lt1 white lines for the Medium family) */
    insideH?: Stroke;
    insideV?: Stroke;
    /** Four sides of the whole-table outer border */
    outer?: {
        l?: Stroke;
        r?: Stroke;
        t?: Stroke;
        b?: Stroke;
    };
    /** First-row bottom edge / last-row top edge (header separator lines, used when the firstRow/lastRow flags are on) */
    firstRowBottom?: Stroke;
    lastRowTop?: Stroke;
}
/** Region toggles from a:tblPr. */
export interface TableStyleFlags {
    firstRow: boolean;
    lastRow: boolean;
    firstCol: boolean;
    lastCol: boolean;
    bandRow: boolean;
    bandCol: boolean;
}
/** Compatibility: the made-up "no style" GUID this app used to write (not in the official table). */
export declare const LEGACY_NO_STYLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307D}";
/**
 * styleId → style definition. Prefers explicit definitions in tableStyles.xml, falling
 * back to the built-in table.
 */
export declare function resolveTableStyle(styleId: string | undefined, tableStylesXml: string | undefined, theme: Theme | undefined): TableStyleDef | undefined;
/**
 * Style borders for cell (r,c) (composed from region borders; explicit tcPr borders
 * take precedence): inner separator lines + whole-table outer border + header
 * separator lines (when the firstRow/lastRow flags are on).
 */
export declare function cellStyleBorders(def: TableStyleDef, flags: TableStyleFlags, r: number, c: number, nRows: number, nCols: number): {
    l?: Stroke;
    r?: Stroke;
    t?: Stroke;
    b?: Stroke;
};
/**
 * Compute the final region style for cell (r,c) (OOXML precedence:
 * wholeTbl < banding < lastRow/firstCol/lastCol < firstRow).
 */
export declare function cellPartStyle(def: TableStyleDef, flags: TableStyleFlags, r: number, c: number, nRows: number, nCols: number): TablePartStyle;
