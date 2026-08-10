import type { NumberingDef } from './types';
export declare function formatNumber(value: number, numFmt: string): string;
export interface ListItemRef {
    numId: string | null;
    ilvl: number;
}
export interface ListMarkerInfo {
    /** display text (symbol glyphs decoded to Unicode) */
    text: string;
    /** bullets declared in a symbol-encoded font: original glyph in U+F0xx form, so the renderer can pass it through when the font is installed */
    symbolChar?: string;
    symbolFont?: string;
}
export declare function bulletMarkerScale(glyph: string): number;
/**
 * Word numbering semantics: counters accumulate document-wide per abstractNum
 * (plain paragraphs in between don't break the sequence); when a level appears,
 * its deeper levels reset; startOverride applies the first time that numId uses
 * the level. Returns a marker array the same length as items; items without a
 * definition return null (CSS fallback handles them).
 */
export declare function computeListMarkerInfos(items: ListItemRef[], defs: Map<string, NumberingDef>): (ListMarkerInfo | null)[];
export declare function computeListMarkers(items: ListItemRef[], defs: Map<string, NumberingDef>): (string | null)[];
