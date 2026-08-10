import type { Transform, TextAlign } from './types';
import { type Theme } from './theme';
/** Default run/paragraph style for one indent level (from lstStyle's lvlNpPr/defRPr). */
export interface LevelTextStyle {
    /** Font size (pt) */
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    latinFont?: string;
    eaFont?: string;
    csFont?: string;
    align?: TextAlign;
    /** Bullet default (master bodyStyle levels commonly use buChar '•') */
    bullet?: {
        type: 'none' | 'char' | 'number';
        char?: string;
    };
    /** Paragraph left indent (EMU) */
    marL?: number;
    /** First-line indent (EMU, negative = hanging) */
    indent?: number;
    /** Line/paragraph spacing defaults (lnSpc/spcBef/spcAft from master txStyles; source of inherited line spacing) */
    lineHeight?: number;
    lineExact?: number;
    spaceBefore?: number;
    spaceAfter?: number;
    spaceBeforePct?: number;
    spaceAfterPct?: number;
}
/** Default styles for the 9 levels (index = level, 0-based). */
export interface TextStyleLevels {
    levels: Array<LevelTextStyle | undefined>;
}
/** master <p:txStyles>: the title/body/other families. */
export interface MasterTextStyles {
    title?: TextStyleLevels;
    body?: TextStyleLevels;
    other?: TextStyleLevels;
}
export interface PlaceholderGeom {
    type: string;
    idx: string;
    transform: Transform | null;
    /** Default text style from this placeholder txBody's <a:lstStyle> */
    textStyle?: TextStyleLevels;
}
/** Placeholder geometry table for one layer (layout or master). */
export interface PlaceholderMap {
    entries: PlaceholderGeom[];
}
/**
 * Extract the placeholder geometry table + lstStyle text style defaults from a
 * layout/master's full XML. Collects shapes that carry <p:ph> and at least one of
 * <a:xfrm> or <a:lstStyle>.
 */
export declare function parsePlaceholderMap(layoutOrMasterXml: string, theme?: Theme): PlaceholderMap;
/** <a:lstStyle> (or one txStyles family) → 9-level style table. */
export declare function parseLstStyleLevels(lst: unknown, theme?: Theme): TextStyleLevels | undefined;
/** master <p:txStyles> → default styles for the title/body/other families. */
export declare function parseMasterTextStyles(masterXml: string, theme?: Theme): MasterTextStyles;
/**
 * Placeholder text style inheritance chain (highest priority first):
 * layout placeholder lstStyle → master placeholder lstStyle → master txStyles
 * (by ph family). The caller may prepend the slide shape's own lstStyle.
 */
export declare function placeholderStyleChain(layout: PlaceholderMap | undefined, master: PlaceholderMap | undefined, masterTx: MasterTextStyles | undefined, type: string | undefined, idx: string | undefined): TextStyleLevels[];
/**
 * Merge one level's default style field by field along the inheritance chain
 * (earlier layers win). When a layer lacks the level, fall back to that layer's
 * lvl1 (lenient fallback).
 */
export declare function mergeTextStyleChain(chain: Array<TextStyleLevels | undefined>, level: number): LevelTextStyle | undefined;
/**
 * Resolve placeholder geometry: layout first, master as fallback.
 * undefined means neither layer has inheritable geometry (the render layer may
 * further fall back to a default or (0,0)).
 */
export declare function resolvePlaceholderTransform(layout: PlaceholderMap | undefined, master: PlaceholderMap | undefined, type: string | undefined, idx: string | undefined): Transform | undefined;
