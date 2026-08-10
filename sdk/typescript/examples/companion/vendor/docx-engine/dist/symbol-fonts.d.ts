/**
 * Symbol-encoded legacy fonts (Symbol / Wingdings / Webdings) carry glyphs at
 * arbitrary byte positions, stored either as that byte or as U+F0xx (private
 * use). Without the font installed they render as the raw letter or tofu, so
 * map the common glyphs to their Unicode equivalents for display.
 */
export declare function isSymbolFont(font: string | null | undefined): boolean;
/** glyph code (raw byte or its U+F0xx private-use form) → Unicode equivalent, null when unknown */
export declare function decodeSymbolChar(font: string, code: number): string | null;
/** raw-byte glyph codes → their U+F0xx private-use form (how symbol-font cmaps index glyphs) */
export declare function toSymbolPua(text: string): string;
/** whole string decode; null unless every non-whitespace char maps */
export declare function decodeSymbolText(font: string, text: string): string | null;
