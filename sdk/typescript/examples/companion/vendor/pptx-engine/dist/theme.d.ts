import { type XmlNode } from './xml-utils';
export interface Theme {
    /** clrScheme: dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink → #RRGGBB */
    colors: Record<string, string>;
    /** fontScheme: major / minor Latin fonts */
    majorFont?: string;
    minorFont?: string;
    /** fontScheme: major / minor East Asian fonts */
    majorEaFont?: string;
    minorEaFont?: string;
    /** fontScheme: major / minor Complex Script fonts (Arabic/Hebrew/Thai/Hindi etc.) */
    majorCsFont?: string;
    minorCsFont?: string;
    /**
     * fmtScheme templates (referenced by style refs: fillRef/lnRef/effectRef; phClr is
     * substituted by the referencing side). Each entry is a parsed node (e.g.
     * { 'a:gradFill': {...} } / { 'a:ln': {...} } / { 'a:effectStyle': {...} }), mapping
     * to idx 1..3 in original XML order; bgFills map to idx 1001..1003.
     */
    fillStyles?: XmlNode[];
    lnStyles?: XmlNode[];
    effectStyles?: XmlNode[];
    bgFillStyles?: XmlNode[];
}
export declare function parseTheme(themeXml: string): Theme;
/**
 * Theme font reference ("+mj-lt" / "+mn-ea" etc.) → final font name.
 * Values not starting with "+" are returned as-is; returns undefined when the theme has no match.
 */
export declare function resolveFontRef(typeface: string | undefined, theme: Theme | undefined): string | undefined;
/** schemeClr name (e.g. 'tx1','bg1','accent1','phClr') → final #RRGGBB. */
export declare function resolveSchemeColor(name: string, theme: Theme | undefined, phClr?: string): string | undefined;
